import { Hono } from "hono";
import { all, exec, one, run } from "../../lib/db";
import type { DB } from "../../lib/db";
import { audit } from "../../lib/audit";
import { addDays, nowDate, nowDateTime } from "../../lib/time";
import type { AccountRow, AccountStatus, Provider } from "../../lib/types";
import { proxyFetch } from "../../lib/proxy-fetch";
import type { ProxyConfig } from "../../lib/proxy-fetch";

export const accountRoutes = new Hono<{ Bindings: Env }>();

const PROVIDERS: readonly Provider[] = ["claude", "gpt", "gemini"];
const STATUSES: readonly AccountStatus[] = ["active", "paused", "problem", "exhausted", "terminated"];

accountRoutes.get("/", async (c) => {
	const provider = c.req.query("provider");
	const status = c.req.query("status");
	const groupName = c.req.query("group_name");
	const isThirdParty = c.req.query("is_third_party");
	const qualityTierStr = c.req.query("quality_tier");
	const q = c.req.query("q");
	const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
	const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

	const where: string[] = ["a.deleted_at IS NULL"];
	const args: unknown[] = [];
	if (provider && PROVIDERS.includes(provider as Provider)) {
		where.push("a.provider = ?");
		args.push(provider);
	}
	if (status && STATUSES.includes(status as AccountStatus)) {
		where.push("a.status = ?");
		args.push(status);
	} else {
		where.push("a.status != 'terminated'");
	}
	if (groupName) {
		where.push("EXISTS (SELECT 1 FROM account_groups ag WHERE ag.account_id = a.id AND ag.group_name = ?)");
		args.push(groupName);
	}
	if (isThirdParty === "1" || isThirdParty === "0") {
		where.push("a.is_third_party = ?");
		args.push(Number(isThirdParty));
	}
	if (qualityTierStr != null && qualityTierStr !== "") {
		const n = Number(qualityTierStr);
		if (Number.isFinite(n)) {
			where.push("a.quality_tier = ?");
			args.push(Math.trunc(n));
		}
	}
	if (q) {
		where.push("(a.email LIKE ? OR a.name LIKE ? OR a.user_id LIKE ?)");
		const like = `%${q}%`;
		args.push(like, like, like);
	}

	const rows = await all<AccountRow & { proxy_label: string | null; kid_count: number; groups_csv: string | null }>(
		c.env.DB,
		`SELECT a.*, (p.host || ':' || p.port) AS proxy_label,
		        (SELECT COUNT(*) FROM kid_mappings km WHERE km.account_id = a.id) AS kid_count,
		        (SELECT GROUP_CONCAT(ag.group_name) FROM account_groups ag WHERE ag.account_id = a.id) AS groups_csv
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id
		 WHERE ${where.join(" AND ")}
		 ORDER BY CASE WHEN a.status = 'active' THEN 0 ELSE 1 END, a.priority DESC, a.id DESC LIMIT ? OFFSET ?`,
		...args,
		limit,
		offset,
	);
	const total = await one<{ n: number }>(
		c.env.DB,
		`SELECT COUNT(*) AS n FROM accounts a WHERE ${where.join(" AND ")}`,
		...args,
	);
	return c.json({ items: rows, total: total?.n ?? 0, limit, offset });
});

// Distinct group names ever used — for the edit-modal dropdown so admins can
// pick a previously-entered group instead of retyping (avoids typos / mismatches).
// Unions account groups with the kid-side bindings so the suggestions also cover
// groups that have kids bound but no account yet.
accountRoutes.get("/groups", async (c) => {
	const provider = c.req.query("provider");
	const filtered = provider != null && PROVIDERS.includes(provider as Provider);
	const sql = filtered
		? `SELECT DISTINCT group_name FROM (
		     SELECT ag.group_name FROM account_groups ag JOIN accounts a ON a.id = ag.account_id WHERE a.provider = ? AND a.deleted_at IS NULL
		     UNION SELECT group_name FROM kid_groups WHERE provider = ?
		     UNION SELECT group_name FROM kid_group_ranges WHERE provider = ?
		   ) WHERE group_name IS NOT NULL AND group_name != '' ORDER BY group_name`
		: `SELECT DISTINCT group_name FROM (
		     SELECT group_name FROM account_groups
		     UNION SELECT group_name FROM kid_groups
		     UNION SELECT group_name FROM kid_group_ranges
		   ) WHERE group_name IS NOT NULL AND group_name != '' ORDER BY group_name`;
	const rows = filtered
		? await all<{ group_name: string }>(c.env.DB, sql, provider, provider, provider)
		: await all<{ group_name: string }>(c.env.DB, sql);
	return c.json({ groups: rows.map((r) => r.group_name) });
});

accountRoutes.get("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const row = await one<AccountRow>(c.env.DB, `SELECT * FROM accounts WHERE id = ?`, id);
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json(row);
});

// Normalize a `groups` payload (string[] or comma-separated string) into a
// deduped, trimmed list of group names.
function normalizeGroups(input: unknown): string[] {
	const raw = Array.isArray(input)
		? input
		: typeof input === "string"
			? input.split(",")
			: [];
	const out: string[] = [];
	for (const g of raw) {
		const name = String(g).trim();
		if (name && !out.includes(name)) out.push(name);
	}
	return out;
}

async function replaceGroups(db: DB, accountId: number, groups: string[]): Promise<void> {
	await run(db, `DELETE FROM account_groups WHERE account_id = ?`, accountId);
	for (const name of groups) {
		await run(db, `INSERT OR IGNORE INTO account_groups (account_id, group_name) VALUES (?, ?)`, accountId, name);
	}
}

accountRoutes.post("/", async (c) => {
	const body = await c.req.json<Partial<AccountRow> & { groups?: unknown }>();
	if (!body.provider || !PROVIDERS.includes(body.provider)) {
		return c.json({ error: "provider required (claude|gpt|gemini)" }, 400);
	}
	const purchase = body.purchase_date ?? nowDate();
	const expire = body.expire_date ?? addDays(purchase, 30);
	const r = await exec(
		c.env.DB,
		`INSERT INTO accounts (
			provider, email, name,
			access_token, access_token_expires_at, refresh_token, refresh_token_expires_at,
			proxy_id, account_level, group_name, user_id, multiplier, tier, quality_tier,
			total_capacity, used_count, status, is_third_party, third_party_api_url, project,
			purchase_date, expire_date
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
		body.provider,
		body.email ?? null,
		body.name ?? null,
		body.access_token ?? null,
		body.access_token_expires_at ?? null,
		body.refresh_token ?? null,
		body.refresh_token_expires_at ?? null,
		body.proxy_id ?? null,
		body.account_level ?? 1,
		body.group_name ?? null,
		body.user_id ?? null,
		body.multiplier ?? 4.0,
		body.tier ?? "pro",
		body.quality_tier ?? 0,
		body.total_capacity ?? 100,
		body.status ?? "active",
		body.is_third_party ?? 0,
		body.third_party_api_url ?? null,
		body.project ?? null,
		purchase,
		expire,
	);
	const groups = normalizeGroups(body.groups ?? body.group_name);
	if (groups.length > 0) await replaceGroups(c.env.DB, r.lastRowId, groups);
	await audit(c.env.DB, "account.create", { type: "account", id: r.lastRowId }, body);
	return c.json({ id: r.lastRowId });
});

accountRoutes.patch("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const body = await c.req.json<Partial<AccountRow> & { groups?: unknown }>();

	// Multi-group is stored in account_groups, not accounts.group_name.
	if ("groups" in body) {
		await replaceGroups(c.env.DB, id, normalizeGroups(body.groups));
	}

	const editable = [
		"email", "name",
		"access_token", "access_token_expires_at", "refresh_token", "refresh_token_expires_at",
		"proxy_id", "account_level", "user_id", "multiplier", "tier", "quality_tier",
		"total_capacity", "used_count", "status", "status_reason",
		"is_third_party", "third_party_api_url", "project",
		"purchase_date", "expire_date", "priority", "keep_active", "rpm_limit",
	] as const;

	const sets: string[] = [];
	const args: unknown[] = [];
	for (const k of editable) {
		if (k in body) {
			sets.push(`${k} = ?`);
			args.push((body as Record<string, unknown>)[k] ?? null);
		}
	}
	if (sets.length === 0) return c.json({ ok: true });
	if ("status" in body) {
		sets.push(`status_changed_at = ?`);
		args.push(nowDateTime());
	}
	sets.push(`updated_at = ?`);
	args.push(nowDateTime());

	args.push(id);
	const r = await run(c.env.DB, `UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`, ...args);
	await audit(c.env.DB, "account.update", { type: "account", id }, body);
	return c.json({ ok: true, changes: r.meta?.changes ?? 0 });
});

accountRoutes.delete("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	await run(c.env.DB, `UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?`, nowDateTime(), nowDateTime(), id);
	await run(c.env.DB, `DELETE FROM kid_mappings WHERE account_id = ?`, id);
	await audit(c.env.DB, "account.delete", { type: "account", id }, null);
	return c.json({ ok: true });
});

// Quick actions
accountRoutes.post("/:id{[0-9]+}/clear-problem", async (c) => {
	const id = Number(c.req.param("id"));
	await run(
		c.env.DB,
		`UPDATE accounts SET status = 'active', status_reason = NULL, status_changed_at = ?, retry_after = NULL, updated_at = ? WHERE id = ?`,
		nowDateTime(),
		nowDateTime(),
		id,
	);
	await audit(c.env.DB, "account.clear_problem", { type: "account", id }, null);
	return c.json({ ok: true });
});

accountRoutes.post("/:id{[0-9]+}/reset-used", async (c) => {
	const id = Number(c.req.param("id"));
	await run(c.env.DB, `UPDATE accounts SET used_count = 0, updated_at = ? WHERE id = ?`, nowDateTime(), id);
	await run(c.env.DB, `DELETE FROM kid_mappings WHERE account_id = ?`, id);
	await audit(c.env.DB, "account.reset_used", { type: "account", id }, null);
	return c.json({ ok: true });
});

// Bulk update quality_tier across many accounts. Used by admin UI for batch ops
// ("select 20 accounts, mark all as quality_tier=5").
// Body: { ids: number[], quality_tier: number }
accountRoutes.post("/bulk-quality-tier", async (c) => {
	const body = await c.req.json<{ ids?: unknown; quality_tier?: unknown }>();
	const ids = Array.isArray(body.ids)
		? body.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
		: [];
	const qt = Number(body.quality_tier);
	if (ids.length === 0) return c.json({ error: "ids required" }, 400);
	if (!Number.isFinite(qt) || qt < 0) return c.json({ error: "quality_tier must be a non-negative number" }, 400);
	const placeholders = ids.map(() => "?").join(",");
	const r = await run(
		c.env.DB,
		`UPDATE accounts SET quality_tier = ?, updated_at = ? WHERE id IN (${placeholders})`,
		Math.trunc(qt),
		nowDateTime(),
		...ids,
	);
	await audit(c.env.DB, "account.bulk_quality_tier", { type: "account", id: 0 }, { ids, quality_tier: Math.trunc(qt) });
	return c.json({ ok: true, changes: r.meta?.changes ?? 0 });
});

type AccountWithProxy = AccountRow & {
	proxy_host: string | null;
	proxy_port: number | null;
	proxy_username: string | null;
	proxy_password: string | null;
	proxy_scheme: string | null;
};

accountRoutes.post("/:id{[0-9]+}/test", async (c) => {
	const id = Number(c.req.param("id"));

	const row = await one<AccountWithProxy>(
		c.env.DB,
		`SELECT a.*, p.host AS proxy_host, p.port AS proxy_port,
		        p.username AS proxy_username, p.password AS proxy_password, p.scheme AS proxy_scheme
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id
		 WHERE a.id = ? AND a.deleted_at IS NULL`,
		id,
	);
	if (!row) return c.json({ error: "not found" }, 404);
	if (!row.access_token) return c.json({ error: "no access_token" }, 400);

	const proxy: ProxyConfig | null = row.proxy_host
		? { host: row.proxy_host, port: row.proxy_port!, username: row.proxy_username, password: row.proxy_password, scheme: (row.proxy_scheme ?? "http") as "http" | "socks5" }
		: null;

	const proxyDisplay = row.proxy_host ? `${row.proxy_scheme ?? "http"}://${row.proxy_host}:${row.proxy_port}` : null;
	const isGpt = row.provider === "gpt";

	let requestUrl: string;
	let requestPayload: unknown;
	let reqHeaders: Record<string, string>;

	if (isGpt) {
		if (!row.third_party_api_url) return c.json({ error: "GPT account missing third_party_api_url" }, 400);
		requestUrl = row.third_party_api_url.replace(/\/$/, "");
		requestPayload = {
			model: "gpt-5.5",
			input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
			max_output_tokens: 1,
		};
		reqHeaders = { "content-type": "application/json", "authorization": `Bearer ${row.access_token}` };
	} else {
		const apiBase = (row.third_party_api_url ?? "https://api.anthropic.com").replace(/\/$/, "");
		const isApiKey = row.is_third_party === 1 && (row.access_token.startsWith("sk-") || row.access_token.startsWith("sk_"));
		requestUrl = `${apiBase}/v1/messages`;
		requestPayload = {
			model: "claude-haiku-4-5-20251001",
			max_tokens: 128,
			messages: [{
				role: "user",
				content: "Please respond with 'active' if you can process this request. Test timestamp: " + new Date().toISOString(),
			}],
			metadata: {
				user_id: "{\"device_id\":\"407303eb15f310c4cced52aee82eea6a21072c9b25dc68f625a8d771a6a0c896\",\"account_uuid\":\"\",\"session_id\":\"ae05ca5a-fba8-4830-9f44-dde696b2a3ad\"}",
			},
		};
		reqHeaders = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
		if (isApiKey) reqHeaders["x-api-key"] = row.access_token;
		else reqHeaders["authorization"] = `Bearer ${row.access_token}`;
	}

	let resp: Response;
	let body: string;
	try {
		resp = await proxyFetch(
			c.env,
			new Request(requestUrl, {
				method: "POST",
				headers: reqHeaders,
				body: JSON.stringify(requestPayload),
			}),
			proxy,
		);
		body = await resp.text();
	} catch (e) {
		const reason = `network error: ${(e as Error).message}`;
		await run(
			c.env.DB,
			`UPDATE accounts SET status = 'problem', status_reason = ?, status_changed_at = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
			reason, nowDateTime(), reason, nowDateTime(), id,
		);
		return c.json({ ok: false, status: "problem", status_reason: reason, http_status: null, request_url: requestUrl, proxy: proxyDisplay, request_payload: requestPayload, response_body: null });
	}

	const LOW_BALANCE_MSGS = ["your credit balance is too low", "this organization has been disabled"];

	let newStatus: AccountStatus;
	let statusReason: string | null = null;

	if (resp.ok) {
		newStatus = "active";
	} else {
		try {
			const parsed = JSON.parse(body) as Record<string, unknown>;
			const msg = ((parsed.error as Record<string, unknown>)?.message ?? parsed.message ?? "") as string;
			statusReason = msg ? msg.slice(0, 300) : `HTTP ${resp.status}`;
		} catch {
			statusReason = `HTTP ${resp.status}`;
		}
		const lowerReason = (statusReason ?? "").toLowerCase();
		if (resp.status === 400 && LOW_BALANCE_MSGS.some((m) => lowerReason.includes(m))) {
			newStatus = "exhausted";
		} else {
			newStatus = "problem";
		}
	}

	if (resp.ok || row.keep_active === 0) {
		await run(
			c.env.DB,
			`UPDATE accounts SET status = ?, status_reason = ?, status_changed_at = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
			newStatus, statusReason, nowDateTime(), body.slice(0, 500), nowDateTime(), id,
		);
	} else {
		await run(
			c.env.DB,
			`UPDATE accounts SET status_reason = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
			statusReason, body.slice(0, 500), nowDateTime(), id,
		);
	}
	await audit(c.env.DB, "account.test", { type: "account", id }, { status: newStatus, http_status: resp.status });
	return c.json({ ok: resp.ok, status: newStatus, status_reason: statusReason, http_status: resp.status, request_url: requestUrl, proxy: proxyDisplay, request_payload: requestPayload, response_body: body });
});

import { Hono } from "hono";
import { all, exec, one, run } from "../../lib/db";
import { audit } from "../../lib/audit";
import { addDays, nowDate, nowDateTime } from "../../lib/time";
import type { AccountRow, AccountStatus, Provider } from "../../lib/types";

export const accountRoutes = new Hono<{ Bindings: Env }>();

const PROVIDERS: readonly Provider[] = ["claude", "gpt", "gemini"];
const STATUSES: readonly AccountStatus[] = ["active", "paused", "problem", "exhausted"];

accountRoutes.get("/", async (c) => {
	const provider = c.req.query("provider");
	const status = c.req.query("status");
	const groupName = c.req.query("group_name");
	const isThirdParty = c.req.query("is_third_party");
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
	}
	if (groupName) {
		where.push("a.group_name = ?");
		args.push(groupName);
	}
	if (isThirdParty === "1" || isThirdParty === "0") {
		where.push("a.is_third_party = ?");
		args.push(Number(isThirdParty));
	}
	if (q) {
		where.push("(a.email LIKE ? OR a.name LIKE ? OR a.user_id LIKE ?)");
		const like = `%${q}%`;
		args.push(like, like, like);
	}

	const rows = await all<AccountRow & { proxy_label: string | null }>(
		c.env.DB,
		`SELECT a.*, (p.host || ':' || p.port) AS proxy_label
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id
		 WHERE ${where.join(" AND ")}
		 ORDER BY a.id DESC LIMIT ? OFFSET ?`,
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

accountRoutes.get("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const row = await one<AccountRow>(c.env.DB, `SELECT * FROM accounts WHERE id = ?`, id);
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json(row);
});

accountRoutes.post("/", async (c) => {
	const body = await c.req.json<Partial<AccountRow>>();
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
			proxy_id, account_level, group_name, user_id, multiplier, tier,
			total_capacity, used_count, status, is_third_party, third_party_api_url, project,
			purchase_date, expire_date
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
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
		body.multiplier ?? 1.0,
		body.tier ?? "pro",
		body.total_capacity ?? 10,
		body.status ?? "active",
		body.is_third_party ?? 0,
		body.third_party_api_url ?? null,
		body.project ?? null,
		purchase,
		expire,
	);
	await audit(c.env.DB, "account.create", { type: "account", id: r.lastRowId }, body);
	return c.json({ id: r.lastRowId });
});

accountRoutes.patch("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const body = await c.req.json<Partial<AccountRow>>();

	const editable = [
		"email", "name",
		"access_token", "access_token_expires_at", "refresh_token", "refresh_token_expires_at",
		"proxy_id", "account_level", "group_name", "user_id", "multiplier", "tier",
		"total_capacity", "used_count", "status", "status_reason",
		"is_third_party", "third_party_api_url", "project",
		"purchase_date", "expire_date",
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

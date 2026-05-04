// Account selection logic ported from account-sync-service/internal/handler/account_sync.go.
// Simplified for D1 (no Redis lock; rely on D1 row counters and atomic UPDATEs).

import { all, one, run } from "../lib/db";
import type { DB } from "../lib/db";
import {
	type AccountResponse,
	type AccountRow,
	type Provider,
} from "../lib/types";
import { nowDateTime } from "../lib/time";
import { proxyConfigToUrl, proxyFetch, type ProxyConfig } from "../lib/proxy-fetch";

const PROBE_DEBOUNCE_MS = 3 * 60 * 1000; // 3 minutes
type AccountWithProxy = AccountRow & {
	px_id: number | null;
	px_host: string | null;
	px_port: number | null;
	px_user: string | null;
	px_pass: string | null;
	px_scheme: string | null;
};

const ACCT_SELECT = `a.*, p.id AS px_id, p.host AS px_host, p.port AS px_port, p.username AS px_user, p.password AS px_pass, p.scheme AS px_scheme`;
const PROXY_JOIN = `LEFT JOIN proxies p ON a.proxy_id = p.id AND p.is_active = 1`;


interface PickOpts {
	provider: Provider;
	kid?: number;
	forceReplace?: boolean;
	problemAccountId?: number;
	isMax?: 0 | 1 | null;
	env: Env;
	ctx: { waitUntil(p: Promise<unknown>): void };
}

export async function pickAccount(db: DB, opts: PickOpts): Promise<
	| { ok: true; response: AccountResponse }
	| { ok: false; status: number; error: string; details?: string }
> {
	const { provider, kid, forceReplace, problemAccountId, isMax, env, ctx } = opts;

	if (problemAccountId && forceReplace) {
		await scheduleProblemProbe(db, env, ctx, problemAccountId);
	}

	// Only exclude the problem account when actively force-replacing.
	// aid without force_replace is informational only and must not affect account selection.
	const excludeId = forceReplace ? (problemAccountId ?? 0) : 0;

	if (kid == null) {
		const list = await listAvailableShared(db, provider, isMax ?? null);
		return { ok: true, response: list[0] ?? emptyResponse() };
	}

	// 1. group binding
	const binding = await one<{ group_name: string }>(
		db,
		`SELECT group_name FROM kid_groups WHERE kid = ?`,
		kid,
	);

	if (binding?.group_name) {
		// Prefer the kid's current mapped account if it's still in the same group and active.
		// Only pick a new random group account if the mapping is missing, stale, or force-replaced.
		if (!forceReplace) {
			const existingMapping = await one<{ account_id: number }>(
				db,
				`SELECT account_id FROM kid_mappings WHERE kid = ? AND provider = ?`,
				kid,
				provider,
			);
			if (existingMapping) {
				const existingAccount = await one<AccountWithProxy>(
					db,
					`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN}
					 WHERE a.id = ? AND a.group_name = ? AND a.status = 'active' AND a.deleted_at IS NULL`,
					existingMapping.account_id,
					binding.group_name,
				);
				if (existingAccount && satisfiesIsMax(existingAccount, isMax ?? null)) {
					ctx.waitUntil(run(db, `UPDATE kid_mappings SET updated_at = ? WHERE kid = ? AND provider = ?`, nowDateTime(), kid, provider));
					return { ok: true, response: formatResponse(existingAccount, true) };
				}
			}
		}

		const account = await findAccountByGroup(db, provider, binding.group_name, isMax ?? null, excludeId);
		if (account) {
			await upsertMapping(db, kid, provider, account.id);
			return { ok: true, response: formatResponse(account, true) };
		}
		if (binding.group_name.startsWith("channel_")) {
			return { ok: false, status: 404, error: "No available accounts in channel group", details: `group=${binding.group_name}` };
		}
		// Non-channel groups fall through to shared pool when no active account found.
	}

	// 2. existing mapping
	const mapping = await one<{ account_id: number }>(
		db,
		`SELECT account_id FROM kid_mappings WHERE kid = ? AND provider = ?`,
		kid,
		provider,
	);
	if (mapping && !forceReplace) {
		const existing = await loadAccount(db, mapping.account_id);
		if (existing && satisfiesIsMax(existing, isMax ?? null) && existing.status === "active") {
			ctx.waitUntil(run(db, `UPDATE kid_mappings SET updated_at = ? WHERE kid = ? AND provider = ?`, nowDateTime(), kid, provider));
			return { ok: true, response: formatResponse(existing, false) };
		}
	}

	// 3. assign new from shared pool; pass known old account_id to skip SELECT inside upsertMapping
	const candidate = await findSharedAvailable(db, provider, isMax ?? null, excludeId);
	if (!candidate) {
		const fallback = await findThirdPartyFallback(db, provider);
		if (!fallback) {
			return { ok: false, status: 404, error: "No available accounts to assign" };
		}
		await upsertMapping(db, kid, provider, fallback.id, mapping?.account_id);
		return { ok: true, response: formatResponse(fallback, false) };
	}
	await upsertMapping(db, kid, provider, candidate.id, mapping?.account_id);
	return { ok: true, response: formatResponse(candidate, false) };
}

function emptyResponse(): AccountResponse {
	return {
		id: 0,
		access_token: "",
		has_claude_max: true,
		device: "linux",
		proxy: "",
		level: 0,
		is_dedicated: false,
		is_third_party: false,
		multiplier: 1,
	};
}

function satisfiesIsMax(a: AccountRow, isMax: 0 | 1 | null): boolean {
	if (isMax == null) return true;
	if (isMax === 1) return a.tier === "max";
	return true;
}

function buildProxyUrl(r: AccountWithProxy): string {
	if (!r.px_id || !r.px_host || !r.px_port) return "";
	return proxyConfigToUrl({
		host: r.px_host,
		port: r.px_port,
		username: r.px_user,
		password: r.px_pass,
		scheme: (r.px_scheme as "http" | "socks5") ?? "http",
	});
}

async function loadAccount(db: DB, id: number): Promise<AccountWithProxy | null> {
	return one<AccountWithProxy>(
		db,
		`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN} WHERE a.id = ? AND a.deleted_at IS NULL`,
		id,
	);
}

async function findAccountByGroup(
	db: DB,
	provider: Provider,
	groupName: string,
	isMax: 0 | 1 | null,
	excludeId: number,
): Promise<AccountWithProxy | null> {
	const tierClause = isMax === 1 ? `AND a.tier = 'max'` : "";
	const excludeClause = excludeId > 0 ? `AND a.id != ${excludeId | 0}` : "";
	return one<AccountWithProxy>(
		db,
		`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN}
		 WHERE a.provider = ? AND a.group_name = ? AND a.status = 'active' AND a.deleted_at IS NULL
		   ${tierClause} ${excludeClause}
		 ORDER BY a.account_level DESC, RANDOM() * (a.priority + 1) DESC LIMIT 1`,
		provider,
		groupName,
	);
}

async function findSharedAvailable(
	db: DB,
	provider: Provider,
	isMax: 0 | 1 | null,
	excludeId: number,
): Promise<AccountWithProxy | null> {
	const tierClause = isMax === 1 ? `AND a.tier = 'max'` : "";
	const excludeClause = excludeId > 0 ? `AND a.id != ${excludeId | 0}` : "";
	return one<AccountWithProxy>(
		db,
		`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN}
		 WHERE a.provider = ? AND a.status = 'active' AND a.deleted_at IS NULL
		   AND (a.group_name IS NULL OR a.group_name = '')
		   AND a.is_third_party = 0
		   AND a.available_count > 0
		   ${tierClause} ${excludeClause}
		 ORDER BY RANDOM() * (a.priority + 1) DESC LIMIT 1`,
		provider,
	);
}

async function findThirdPartyFallback(db: DB, provider: Provider): Promise<AccountWithProxy | null> {
	return one<AccountWithProxy>(
		db,
		`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN}
		 WHERE a.provider = ? AND a.is_third_party = 1 AND a.status = 'active' AND a.deleted_at IS NULL
		   AND (a.group_name IS NULL OR a.group_name = '')
		 ORDER BY RANDOM() LIMIT 1`,
		provider,
	);
}

async function upsertMapping(
	db: DB,
	kid: number,
	provider: Provider,
	accountId: number,
	knownOldAccountId?: number,
): Promise<void> {
	const ts = nowDateTime();

	// Use the old account_id the caller already fetched, or query for it.
	const oldAccountId = knownOldAccountId ?? (await one<{ account_id: number }>(
		db,
		`SELECT account_id FROM kid_mappings WHERE kid = ? AND provider = ?`,
		kid,
		provider,
	))?.account_id;

	if (oldAccountId !== undefined) {
		if (oldAccountId !== accountId) {
			await run(db, `UPDATE accounts SET used_count = MAX(used_count - 1, 0), updated_at = ? WHERE id = ?`, ts, oldAccountId);
			await run(db, `UPDATE accounts SET used_count = used_count + 1, updated_at = ? WHERE id = ?`, ts, accountId);
			await run(db, `UPDATE kid_mappings SET account_id = ?, updated_at = ? WHERE kid = ? AND provider = ?`, accountId, ts, kid, provider);
		} else {
			await run(db, `UPDATE kid_mappings SET updated_at = ? WHERE kid = ? AND provider = ?`, ts, kid, provider);
		}
	} else {
		await run(db, `INSERT INTO kid_mappings (kid, provider, account_id) VALUES (?, ?, ?)`, kid, provider, accountId);
		await run(db, `UPDATE accounts SET used_count = used_count + 1, updated_at = ? WHERE id = ?`, ts, accountId);
	}
}

// Schedule an async probe for a client-reported problem account.
// Debounced: at most once per PROBE_DEBOUNCE_MS per account.
// Only marks as problem if the probe actually fails — client reports are not trusted directly.
async function scheduleProblemProbe(
	db: DB,
	env: Env,
	ctx: { waitUntil(p: Promise<unknown>): void },
	accountId: number,
): Promise<void> {
	const row = await one<{ last_probed_at: string | null }>(
		db,
		`SELECT last_probed_at FROM accounts WHERE id = ? AND deleted_at IS NULL`,
		accountId,
	);
	if (!row) return;

	if (row.last_probed_at) {
		const elapsed = Date.now() - new Date(row.last_probed_at.replace(" ", "T") + "Z").getTime();
		if (elapsed < PROBE_DEBOUNCE_MS) return;
	}

	await run(db, `UPDATE accounts SET last_probed_at = ? WHERE id = ?`, nowDateTime(), accountId);
	ctx.waitUntil(probeAndMark(db, env, accountId));
}

async function probeAndMark(db: DB, env: Env, accountId: number): Promise<void> {
	const row = await one<{
		access_token: string | null;
		third_party_api_url: string | null;
		px_host: string | null; px_port: number | null;
		px_user: string | null; px_pass: string | null; px_scheme: string | null;
	}>(
		db,
		`SELECT a.access_token, a.third_party_api_url,
		        p.host AS px_host, p.port AS px_port,
		        p.username AS px_user, p.password AS px_pass, p.scheme AS px_scheme
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id AND p.is_active = 1
		 WHERE a.id = ? AND a.deleted_at IS NULL`,
		accountId,
	);
	if (!row || !row.access_token) return;

	const proxy: ProxyConfig | null = row.px_host && row.px_port
		? { host: row.px_host, port: row.px_port, username: row.px_user, password: row.px_pass, scheme: (row.px_scheme as "http" | "socks5") ?? "http" }
		: null;

	const apiBase = (row.third_party_api_url ?? "https://api.anthropic.com").replace(/\/$/, "");
	const isApiKey = row.access_token.startsWith("sk-") || row.access_token.startsWith("sk_");
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"anthropic-version": "2023-06-01",
		...(isApiKey ? { "x-api-key": row.access_token } : { authorization: `Bearer ${row.access_token}` }),
	};

	try {
		const resp = await proxyFetch(
			env,
			new Request(`${apiBase}/v1/messages`, {
				method: "POST",
				headers,
				body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
			}),
			proxy,
		);
		if (!resp.ok) {
			const body = await resp.text().catch(() => "");
			let reason = `HTTP ${resp.status}`;
			try {
				const parsed = JSON.parse(body) as Record<string, unknown>;
				const msg = ((parsed.error as Record<string, unknown>)?.message ?? "") as string;
				if (msg) reason = msg.slice(0, 300);
			} catch { /* ignore */ }
			const ts = nowDateTime();
			await run(
				db,
				`UPDATE accounts SET status = 'problem', status_reason = ?, status_changed_at = ?, updated_at = ? WHERE id = ?`,
				`${reason} (probe confirmed client report)`, ts, ts, accountId,
			);
		}
	} catch (e) {
		const ts = nowDateTime();
		await run(
			db,
			`UPDATE accounts SET status = 'problem', status_reason = ?, status_changed_at = ?, updated_at = ? WHERE id = ?`,
			`probe error: ${(e as Error).message}`, ts, ts, accountId,
		);
	}
}

function formatResponse(a: AccountWithProxy, isDedicated: boolean): AccountResponse {
	const r: AccountResponse = {
		id: a.id,
		access_token: a.access_token ?? "",
		has_claude_max: true,
		device: "linux",
		proxy: buildProxyUrl(a),
		level: a.account_level,
		is_dedicated: isDedicated,
		is_third_party: a.is_third_party === 1,
		multiplier: a.multiplier,
	};
	if (a.project) r.project = a.project;
	if (a.third_party_api_url) r.third_party_api_url = a.third_party_api_url;
	if (a.user_id) r.user_id = a.user_id;
	return r;
}

export async function listAvailableShared(
	db: DB,
	provider: Provider,
	isMax: 0 | 1 | null,
): Promise<AccountResponse[]> {
	const tierClause = isMax === 1 ? `AND a.tier = 'max'` : "";
	const rows = await all<AccountWithProxy>(
		db,
		`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN}
		 WHERE a.provider = ? AND a.status = 'active' AND a.deleted_at IS NULL
		   AND (a.group_name IS NULL OR a.group_name = '')
		   ${tierClause}`,
		provider,
	);
	const out: AccountResponse[] = [];
	for (const r of rows) {
		if (!r.access_token) continue;
		const proxyUrl = buildProxyUrl(r);
		if (!r.is_third_party && !proxyUrl) continue;
		out.push({
			id: r.id,
			access_token: r.access_token,
			has_claude_max: true,
			device: "linux",
			proxy: proxyUrl,
			level: r.account_level,
			is_dedicated: false,
			is_third_party: r.is_third_party === 1,
			multiplier: r.multiplier,
			...(r.third_party_api_url ? { third_party_api_url: r.third_party_api_url } : {}),
			...(r.user_id ? { user_id: r.user_id } : {}),
			...(r.project ? { project: r.project } : {}),
		});
	}
	return out;
}

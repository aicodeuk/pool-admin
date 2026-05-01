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
import { proxyConfigToUrl } from "../lib/proxy-fetch";

const ORG_FALLBACK_GROUPS = ["channel_max", "channel_aws_chip", "channel_api"];

type GroupKind = "channel" | "org" | "normal";

// Accounts with proxy fields joined inline — avoids a separate SELECT per request.
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

function deriveGroupKind(name: string): GroupKind {
	if (name.startsWith("channel_")) return "channel";
	if (name.startsWith("org_")) return "org";
	return "normal";
}

interface PickOpts {
	provider: Provider;
	kid?: number;
	forceReplace?: boolean;
	problemAccountId?: number;
	isMax?: 0 | 1 | null;
}

export async function pickAccount(db: DB, opts: PickOpts): Promise<
	| { ok: true; response: AccountResponse }
	| { ok: false; status: number; error: string; details?: string }
> {
	const { provider, kid, forceReplace, problemAccountId, isMax } = opts;

	if (problemAccountId && forceReplace) {
		await markAccountProblem(db, problemAccountId);
	}

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
		const kind = deriveGroupKind(binding.group_name);
		const account = await findAccountByGroup(db, provider, binding.group_name, isMax ?? null, problemAccountId ?? 0);
		if (account) {
			await upsertMapping(db, kid, provider, account.id);
			return { ok: true, response: formatResponse(account, true) };
		}
		if (kind === "channel") {
			return { ok: false, status: 404, error: "No available accounts in channel group", details: `group=${binding.group_name}` };
		}
		if (kind === "org") {
			// Single query with priority ordering instead of sequential loop.
			const a = await findAccountByGroups(db, provider, ORG_FALLBACK_GROUPS, isMax ?? null, problemAccountId ?? 0);
			if (a) {
				await upsertMapping(db, kid, provider, a.id);
				return { ok: true, response: formatResponse(a, true) };
			}
			return { ok: false, status: 404, error: "org_group_exhausted", details: binding.group_name };
		}
		// 'normal' falls through to shared pool selection
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
			return { ok: true, response: formatResponse(existing, false) };
		}
	}

	// 3. assign new from shared pool; pass known old account_id to skip SELECT inside upsertMapping
	const candidate = await findSharedAvailable(db, provider, isMax ?? null, problemAccountId ?? 0);
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
		 ORDER BY a.account_level DESC, RANDOM() LIMIT 1`,
		provider,
		groupName,
	);
}

// Single-query replacement for the sequential org-fallback loop.
// Preserves priority order of groupNames via CASE ordering.
async function findAccountByGroups(
	db: DB,
	provider: Provider,
	groupNames: readonly string[],
	isMax: 0 | 1 | null,
	excludeId: number,
): Promise<AccountWithProxy | null> {
	const tierClause = isMax === 1 ? `AND a.tier = 'max'` : "";
	const excludeClause = excludeId > 0 ? `AND a.id != ${excludeId | 0}` : "";
	const placeholders = groupNames.map(() => "?").join(", ");
	const caseWhen = groupNames.map((g, i) => `WHEN '${g.replace(/'/g, "''")}' THEN ${i}`).join(" ");
	return one<AccountWithProxy>(
		db,
		`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN}
		 WHERE a.provider = ? AND a.group_name IN (${placeholders}) AND a.status = 'active' AND a.deleted_at IS NULL
		   ${tierClause} ${excludeClause}
		 ORDER BY CASE a.group_name ${caseWhen} END, RANDOM() LIMIT 1`,
		provider,
		...groupNames,
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
		 ORDER BY RANDOM() LIMIT 1`,
		provider,
	);
}

async function findThirdPartyFallback(db: DB, provider: Provider): Promise<AccountWithProxy | null> {
	return one<AccountWithProxy>(
		db,
		`SELECT ${ACCT_SELECT} FROM accounts a ${PROXY_JOIN}
		 WHERE a.provider = ? AND a.is_third_party = 1 AND a.deleted_at IS NULL
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

async function markAccountProblem(db: DB, id: number): Promise<void> {
	const ts = nowDateTime();
	await run(
		db,
		`UPDATE accounts
		 SET status = 'problem', status_reason = 'Marked by client (force_replace)',
		     status_changed_at = ?, updated_at = ?
		 WHERE id = ?`,
		ts,
		ts,
		id,
	);
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

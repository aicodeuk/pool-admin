// Account selection logic ported from account-sync-service/internal/handler/account_sync.go.
// Simplified for D1 (no Redis lock; rely on D1 row counters and atomic UPDATEs).

import { all, one, run } from "../lib/db";
import type { DB } from "../lib/db";
import {
	type AccountResponse,
	type AccountRow,
	type Provider,
	type ProxyRow,
} from "../lib/types";
import { nowDateTime } from "../lib/time";
import { proxyConfigToUrl } from "../lib/proxy-fetch";

const ORG_FALLBACK_GROUPS = ["channel_max", "channel_aws_chip", "channel_api"];

type GroupKind = "channel" | "org" | "normal";

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
		// list() returns AccountResponse[] but pickAccount returns single. The all-shared
		// path is exposed via a separate handler — keep this branch unused here.
		return { ok: true, response: list[0] ?? emptyResponse() };
	}

	// 1. group binding (free-text in kid_groups; kind derived from prefix)
	const binding = await one<{ group_name: string }>(
		db,
		`SELECT group_name FROM kid_groups WHERE kid = ?`,
		kid,
	);

	if (binding && binding.group_name) {
		const kind = deriveGroupKind(binding.group_name);
		const account = await findAccountByGroup(db, provider, binding.group_name, isMax ?? null, problemAccountId ?? 0);
		if (account) {
			await upsertMapping(db, kid, provider, account.id, problemAccountId);
			return { ok: true, response: await formatResponse(db, account, true) };
		}
		if (kind === "channel") {
			return { ok: false, status: 404, error: "No available accounts in channel group", details: `group=${binding.group_name}` };
		}
		if (kind === "org") {
			for (const fb of ORG_FALLBACK_GROUPS) {
				const a = await findAccountByGroup(db, provider, fb, isMax ?? null, problemAccountId ?? 0);
				if (a) {
					await upsertMapping(db, kid, provider, a.id, problemAccountId);
					return { ok: true, response: await formatResponse(db, a, true) };
				}
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
			return { ok: true, response: await formatResponse(db, existing, false) };
		}
	}

	// 3. assign new from shared pool
	const candidate = await findSharedAvailable(db, provider, isMax ?? null, problemAccountId ?? 0);
	if (!candidate) {
		const fallback = await findThirdPartyFallback(db, provider);
		if (!fallback) {
			return { ok: false, status: 404, error: "No available accounts to assign" };
		}
		await upsertMapping(db, kid, provider, fallback.id, problemAccountId);
		return { ok: true, response: await formatResponse(db, fallback, false) };
	}
	await upsertMapping(db, kid, provider, candidate.id, problemAccountId);
	return { ok: true, response: await formatResponse(db, candidate, false) };
}

function emptyResponse(): AccountResponse {
	return {
		id: 0,
		access_token: "",
		has_claude_max: false,
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
	return true; // isMax=0 accepts all
}

async function loadAccount(db: DB, id: number): Promise<AccountRow | null> {
	return one<AccountRow>(db, `SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL`, id);
}

async function loadProxyUrl(db: DB, proxyId: number | null): Promise<string> {
	if (!proxyId) return "";
	const p = await one<ProxyRow>(db, `SELECT * FROM proxies WHERE id = ? AND is_active = 1`, proxyId);
	if (!p) return "";
	return proxyConfigToUrl({
		host: p.host,
		port: p.port,
		username: p.username,
		password: p.password,
		scheme: p.scheme,
	});
}

async function findAccountByGroup(
	db: DB,
	provider: Provider,
	groupName: string,
	isMax: 0 | 1 | null,
	excludeId: number,
): Promise<AccountRow | null> {
	const tierClause = isMax === 1 ? `AND tier = 'max'` : "";
	const excludeClause = excludeId > 0 ? `AND id != ${excludeId | 0}` : "";
	return one<AccountRow>(
		db,
		`SELECT * FROM accounts
		 WHERE provider = ? AND group_name = ? AND status = 'active' AND deleted_at IS NULL
		   ${tierClause} ${excludeClause}
		 ORDER BY account_level DESC, RANDOM() LIMIT 1`,
		provider,
		groupName,
	);
}

async function findSharedAvailable(
	db: DB,
	provider: Provider,
	isMax: 0 | 1 | null,
	excludeId: number,
): Promise<AccountRow | null> {
	const tierClause = isMax === 1 ? `AND tier = 'max'` : "";
	const excludeClause = excludeId > 0 ? `AND id != ${excludeId | 0}` : "";
	return one<AccountRow>(
		db,
		`SELECT * FROM accounts
		 WHERE provider = ? AND status = 'active' AND deleted_at IS NULL
		   AND (group_name IS NULL OR group_name = '')
		   AND is_third_party = 0
		   AND available_count > 0
		   ${tierClause} ${excludeClause}
		 ORDER BY RANDOM() LIMIT 1`,
		provider,
	);
}

async function findThirdPartyFallback(db: DB, provider: Provider): Promise<AccountRow | null> {
	return one<AccountRow>(
		db,
		`SELECT * FROM accounts
		 WHERE provider = ? AND is_third_party = 1 AND deleted_at IS NULL
		   AND (group_name IS NULL OR group_name = '')
		 ORDER BY RANDOM() LIMIT 1`,
		provider,
	);
}

async function upsertMapping(
	db: DB,
	kid: number,
	provider: Provider,
	accountId: number,
	oldAccountId?: number,
): Promise<void> {
	const ts = nowDateTime();
	const existing = await one<{ id: number; account_id: number }>(
		db,
		`SELECT id, account_id FROM kid_mappings WHERE kid = ? AND provider = ?`,
		kid,
		provider,
	);
	if (existing) {
		if (existing.account_id !== accountId) {
			await run(db, `UPDATE accounts SET used_count = MAX(used_count - 1, 0), updated_at = ? WHERE id = ?`, ts, existing.account_id);
			await run(db, `UPDATE accounts SET used_count = used_count + 1, updated_at = ? WHERE id = ?`, ts, accountId);
			await run(db, `UPDATE kid_mappings SET account_id = ?, updated_at = ? WHERE id = ?`, accountId, ts, existing.id);
		} else {
			await run(db, `UPDATE kid_mappings SET updated_at = ? WHERE id = ?`, ts, existing.id);
		}
	} else {
		await run(db, `INSERT INTO kid_mappings (kid, provider, account_id) VALUES (?, ?, ?)`, kid, provider, accountId);
		await run(db, `UPDATE accounts SET used_count = used_count + 1, updated_at = ? WHERE id = ?`, ts, accountId);
	}
	if (oldAccountId && oldAccountId !== accountId) {
		// best-effort already counted via decrement above
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

async function formatResponse(db: DB, a: AccountRow, isDedicated: boolean): Promise<AccountResponse> {
	const proxyUrl = await loadProxyUrl(db, a.proxy_id);
	const r: AccountResponse = {
		id: a.id,
		access_token: a.access_token ?? "",
		has_claude_max: a.tier === "max",
		device: "linux",
		proxy: proxyUrl,
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
	const rows = await all<AccountRow & { px_id: number | null; px_host: string | null; px_port: number | null; px_user: string | null; px_pass: string | null; px_scheme: string | null }>(
		db,
		`SELECT a.*, p.id AS px_id, p.host AS px_host, p.port AS px_port, p.username AS px_user, p.password AS px_pass, p.scheme AS px_scheme
		 FROM accounts a LEFT JOIN proxies p ON a.proxy_id = p.id AND p.is_active = 1
		 WHERE a.provider = ? AND a.status = 'active' AND a.deleted_at IS NULL
		   AND (a.group_name IS NULL OR a.group_name = '')
		   ${tierClause}`,
		provider,
	);
	const out: AccountResponse[] = [];
	for (const r of rows) {
		if (!r.access_token) continue;
		let proxyUrl = "";
		if (r.px_id && r.px_host && r.px_port) {
			proxyUrl = proxyConfigToUrl({
				host: r.px_host,
				port: r.px_port,
				username: r.px_user,
				password: r.px_pass,
				scheme: (r.px_scheme as "http" | "socks5") ?? "http",
			});
		}
		if (!r.is_third_party && !proxyUrl) continue;
		out.push({
			id: r.id,
			access_token: r.access_token,
			has_claude_max: r.tier === "max",
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

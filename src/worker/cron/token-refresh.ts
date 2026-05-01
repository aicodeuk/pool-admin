// Refresh Claude access tokens that are expired or expiring within 30 minutes.
// Ported from internal/cli/token_refresh.go (essential subset).

import { all, run } from "../lib/db";
import { fromTimestampMs, nowDateTime } from "../lib/time";
import { proxyFetch, type ProxyConfig } from "../lib/proxy-fetch";
import type { AccountRow, ProxyRow } from "../lib/types";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

export async function refreshExpiringTokens(env: Env, batch = 50): Promise<{ tried: number; ok: number }> {
	const rows = await all<AccountRow & { px_host: string | null; px_port: number | null; px_user: string | null; px_pass: string | null; px_scheme: string | null }>(
		env.DB,
		`SELECT a.*, p.host AS px_host, p.port AS px_port, p.username AS px_user, p.password AS px_pass, p.scheme AS px_scheme
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id AND p.is_active = 1
		 WHERE a.provider = 'claude' AND a.deleted_at IS NULL
		   AND a.is_third_party = 0 AND a.refresh_token IS NOT NULL
		   AND (a.access_token_expires_at IS NULL OR datetime(a.access_token_expires_at) <= datetime('now', '+30 minutes'))
		 LIMIT ?`,
		batch,
	);
	let ok = 0;
	for (const r of rows) {
		const proxy: ProxyConfig | null = r.px_host && r.px_port
			? {
				host: r.px_host,
				port: r.px_port,
				username: r.px_user,
				password: r.px_pass,
				scheme: (r.px_scheme as "http" | "socks5") ?? "http",
			}
			: null;
		try {
			const resp = await proxyFetch(env, TOKEN_URL, proxy, {
				method: "POST",
				headers: { "Content-Type": "application/json", "User-Agent": "axios/1.13.4" },
				body: JSON.stringify({
					client_id: CLIENT_ID,
					grant_type: "refresh_token",
					refresh_token: r.refresh_token,
				}),
			});
			const text = await resp.text();
			if (!resp.ok) {
				await run(
					env.DB,
					`UPDATE accounts SET status_reason = ?, status_changed_at = ?, updated_at = ? WHERE id = ?`,
					`token refresh failed: ${resp.status}`,
					nowDateTime(),
					nowDateTime(),
					r.id,
				);
				continue;
			}
			const data = JSON.parse(text) as { access_token?: string; refresh_token?: string; expires_in?: number };
			if (!data.access_token) continue;
			const expiresAt = fromTimestampMs(Date.now() + (data.expires_in && data.expires_in > 0 ? data.expires_in * 1000 : 8 * 3600 * 1000));
			await run(
				env.DB,
				`UPDATE accounts SET access_token = ?, access_token_expires_at = ?, refresh_token = COALESCE(?, refresh_token), updated_at = ? WHERE id = ?`,
				data.access_token,
				expiresAt,
				data.refresh_token ?? null,
				nowDateTime(),
				r.id,
			);
			ok++;
		} catch (e) {
			await run(
				env.DB,
				`UPDATE accounts SET status_reason = ?, status_changed_at = ?, updated_at = ? WHERE id = ?`,
				`token refresh error: ${(e as Error).message}`,
				nowDateTime(),
				nowDateTime(),
				r.id,
			);
		}
	}
	return { tried: rows.length, ok };
}

// Re-export type so D1Database is referenced; keeps type-only import alive.
export type { ProxyRow };

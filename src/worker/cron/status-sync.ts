// Probe accounts marked as problematic or whose retry_after has elapsed.
// Loosely ports internal/service/account_status_sync.go: simple HEAD/GET probe
// against the OAuth endpoint, flips status back to 'active' on success.

import { all, run } from "../lib/db";
import { nowDateTime } from "../lib/time";
import { proxyFetch, type ProxyConfig } from "../lib/proxy-fetch";

const PROBE_URL = "https://api.anthropic.com/api/oauth/usage";

export async function syncStatus(env: Env, batch = 50): Promise<{ tried: number; recovered: number }> {
	const rows = await all<{
		id: number; access_token: string | null; status: string;
		px_host: string | null; px_port: number | null; px_user: string | null; px_pass: string | null; px_scheme: string | null;
	}>(
		env.DB,
		`SELECT a.id, a.access_token, a.status,
		        p.host AS px_host, p.port AS px_port, p.username AS px_user, p.password AS px_pass, p.scheme AS px_scheme
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id AND p.is_active = 1
		 WHERE a.deleted_at IS NULL AND a.is_third_party = 0
		   AND (
		     (a.status = 'problem' AND (a.status_changed_at IS NULL OR datetime(a.status_changed_at) <= datetime('now', '-1 minute')))
		     OR (a.retry_after IS NOT NULL AND datetime(a.retry_after) <= datetime('now'))
		   )
		 LIMIT ?`,
		batch,
	);

	let recovered = 0;
	for (const r of rows) {
		const proxy: ProxyConfig | null = r.px_host && r.px_port
			? { host: r.px_host, port: r.px_port, username: r.px_user, password: r.px_pass, scheme: (r.px_scheme as "http" | "socks5") ?? "http" }
			: null;
		try {
			const resp = await proxyFetch(env, PROBE_URL, proxy, {
				headers: r.access_token ? { Authorization: `Bearer ${r.access_token}`, "User-Agent": "axios/1.13.4" } : { "User-Agent": "axios/1.13.4" },
			});
			const ok = resp.ok || resp.status === 401; // 401 = token issue, not a network/proxy issue
			const ts = nowDateTime();
			if (ok) {
				await run(
					env.DB,
					`UPDATE accounts SET status = 'active', status_reason = NULL, status_changed_at = ?, retry_after = NULL, last_test_response = ?, updated_at = ? WHERE id = ?`,
					ts,
					`HTTP ${resp.status}`,
					ts,
					r.id,
				);
				recovered++;
			} else {
				await run(
					env.DB,
					`UPDATE accounts SET status_changed_at = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
					ts,
					`HTTP ${resp.status}`,
					ts,
					r.id,
				);
			}
		} catch (e) {
			await run(
				env.DB,
				`UPDATE accounts SET status_changed_at = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
				nowDateTime(),
				`error: ${(e as Error).message}`,
				nowDateTime(),
				r.id,
			);
		}
	}
	return { tried: rows.length, recovered };
}

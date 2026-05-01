// Sync Claude OAuth usage snapshots (5h / 7d / 7d_sonnet) into accounts table.
// Original: internal/service/claude_usage_sync.go.

import { all, run } from "../lib/db";
import { nowDateTime } from "../lib/time";
import { proxyFetch, type ProxyConfig } from "../lib/proxy-fetch";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

interface UsageBlock {
	utilization?: number;
	resets_at?: string;
}
interface UsageResponse {
	five_hour?: UsageBlock;
	seven_day?: UsageBlock;
	seven_day_sonnet?: UsageBlock;
}

export async function syncUsage(env: Env, batch = 50): Promise<{ tried: number; ok: number }> {
	const rows = await all<{
		id: number; access_token: string | null;
		px_host: string | null; px_port: number | null; px_user: string | null; px_pass: string | null; px_scheme: string | null;
	}>(
		env.DB,
		`SELECT a.id, a.access_token,
		        p.host AS px_host, p.port AS px_port, p.username AS px_user, p.password AS px_pass, p.scheme AS px_scheme
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id AND p.is_active = 1
		 WHERE a.provider = 'claude' AND a.deleted_at IS NULL
		   AND a.is_third_party = 0 AND a.status = 'active' AND a.access_token IS NOT NULL
		 ORDER BY COALESCE(a.usage_updated_at, '1970-01-01') ASC
		 LIMIT ?`,
		batch,
	);

	let ok = 0;
	for (const r of rows) {
		const proxy: ProxyConfig | null = r.px_host && r.px_port
			? { host: r.px_host, port: r.px_port, username: r.px_user, password: r.px_pass, scheme: (r.px_scheme as "http" | "socks5") ?? "http" }
			: null;
		try {
			const resp = await proxyFetch(env, USAGE_URL, proxy, {
				headers: {
					"Authorization": `Bearer ${r.access_token}`,
					"User-Agent": "axios/1.13.4",
				},
			});
			if (!resp.ok) {
				await run(
					env.DB,
					`UPDATE accounts SET usage_updated_at = ?, usage_error = ?, updated_at = ? WHERE id = ?`,
					nowDateTime(),
					`status ${resp.status}`,
					nowDateTime(),
					r.id,
				);
				continue;
			}
			const data = (await resp.json()) as UsageResponse;
			await run(
				env.DB,
				`UPDATE accounts SET
					usage_5h_pct = ?, usage_5h_resets_at = ?,
					usage_7d_pct = ?, usage_7d_resets_at = ?,
					usage_7d_sonnet_pct = ?, usage_7d_sonnet_resets_at = ?,
					usage_updated_at = ?, usage_error = NULL, updated_at = ?
				 WHERE id = ?`,
				data.five_hour?.utilization ?? null,
				data.five_hour?.resets_at ?? null,
				data.seven_day?.utilization ?? null,
				data.seven_day?.resets_at ?? null,
				data.seven_day_sonnet?.utilization ?? null,
				data.seven_day_sonnet?.resets_at ?? null,
				nowDateTime(),
				nowDateTime(),
				r.id,
			);
			ok++;
		} catch (e) {
			await run(
				env.DB,
				`UPDATE accounts SET usage_updated_at = ?, usage_error = ?, updated_at = ? WHERE id = ?`,
				nowDateTime(),
				(e as Error).message,
				nowDateTime(),
				r.id,
			);
		}
	}
	return { tried: rows.length, ok };
}

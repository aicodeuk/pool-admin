import { all, run } from "../lib/db";
import { nowDateTime } from "../lib/time";
import { proxyFetch, type ProxyConfig } from "../lib/proxy-fetch";

const PAUSE_MESSAGES = [
	"your credit balance is too low",
	"this organization has been disabled",
];

function shouldPause(httpStatus: number, message: string): boolean {
	if (httpStatus !== 400) return false;
	const lower = message.toLowerCase();
	return PAUSE_MESSAGES.some((m) => lower.includes(m));
}

const PROBE_PAYLOAD = JSON.stringify({
	model: "claude-haiku-4-5-20251001",
	max_tokens: 1,
	messages: [{ role: "user", content: "hi" }],
});

export async function syncStatus(env: Env, batch = 50): Promise<{ tried: number; recovered: number }> {
	const rows = await all<{
		id: number; access_token: string | null; status: string;
		third_party_api_url: string | null;
		px_host: string | null; px_port: number | null; px_user: string | null; px_pass: string | null; px_scheme: string | null;
	}>(
		env.DB,
		`SELECT a.id, a.access_token, a.status, a.third_party_api_url,
		        p.host AS px_host, p.port AS px_port, p.username AS px_user, p.password AS px_pass, p.scheme AS px_scheme
		 FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id AND p.is_active = 1
		 WHERE a.deleted_at IS NULL
		   AND (
		     (a.status = 'problem' AND (a.status_changed_at IS NULL OR datetime(a.status_changed_at) <= datetime('now', '-1 minute')))
		     OR (a.retry_after IS NOT NULL AND datetime(a.retry_after) <= datetime('now'))
		   )
		 LIMIT ?`,
		batch,
	);

	let recovered = 0;
	for (const r of rows) {
		if (!r.access_token) continue;

		const proxy: ProxyConfig | null = r.px_host && r.px_port
			? { host: r.px_host, port: r.px_port, username: r.px_user, password: r.px_pass, scheme: (r.px_scheme as "http" | "socks5") ?? "http" }
			: null;

		const apiBase = (r.third_party_api_url ?? "https://api.anthropic.com").replace(/\/$/, "");
		const isApiKey = r.access_token.startsWith("sk-") || r.access_token.startsWith("sk_");
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"anthropic-version": "2023-06-01",
			...(isApiKey ? { "x-api-key": r.access_token } : { authorization: `Bearer ${r.access_token}` }),
		};

		const ts = nowDateTime();
		try {
			const resp = await proxyFetch(
				env,
				new Request(`${apiBase}/v1/messages`, { method: "POST", headers, body: PROBE_PAYLOAD }),
				proxy,
			);
			const body = await resp.text().catch(() => "");
			if (resp.ok) {
				await run(
					env.DB,
					`UPDATE accounts SET status = 'active', status_reason = NULL, status_changed_at = ?, retry_after = NULL, last_test_response = ?, updated_at = ? WHERE id = ?`,
					ts, `HTTP ${resp.status}`, ts, r.id,
				);
				recovered++;
			} else {
				let reason = `HTTP ${resp.status}`;
				try {
					const parsed = JSON.parse(body) as Record<string, unknown>;
					const msg = ((parsed.error as Record<string, unknown>)?.message ?? "") as string;
					if (msg) reason = msg.slice(0, 300);
				} catch { /* ignore */ }
				if (shouldPause(resp.status, reason)) {
					await run(
						env.DB,
						`UPDATE accounts SET status = 'paused', status_reason = ?, status_changed_at = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
						reason, ts, body.slice(0, 500), ts, r.id,
					);
				} else {
					await run(
						env.DB,
						`UPDATE accounts SET status_reason = ?, status_changed_at = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
						reason, ts, body.slice(0, 500), ts, r.id,
					);
				}
			}
		} catch (e) {
			await run(
				env.DB,
				`UPDATE accounts SET status_changed_at = ?, last_test_response = ?, updated_at = ? WHERE id = ?`,
				ts, `error: ${(e as Error).message}`, ts, r.id,
			);
		}
	}
	return { tried: rows.length, recovered };
}

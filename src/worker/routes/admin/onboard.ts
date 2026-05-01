// Claude OAuth onboarding via web form (replaces the original `claude-oauth` CLI).
//   POST /api/admin/onboard/start  -> returns authorize_url + state (kept on client)
//   POST /api/admin/onboard/complete -> exchanges code through proxy, writes account
//
// The exchange step REQUIRES the proxy-egress gateway. If env.PROXY is not bound
// the request will go direct, which Anthropic typically blocks.

import { Hono } from "hono";
import { exec, one, run } from "../../lib/db";
import { audit } from "../../lib/audit";
import { addDays, fromTimestampMs, nowDate, nowDateTime } from "../../lib/time";
import { proxyConfigToUrl, proxyFetch, type ProxyConfig } from "../../lib/proxy-fetch";

export const onboardRoutes = new Hono<{ Bindings: Env }>();

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const SCOPE =
	"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

function b64url(buf: ArrayBuffer | Uint8Array): string {
	const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let s = "";
	for (const b of u8) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
	const raw = crypto.getRandomValues(new Uint8Array(32));
	const verifier = b64url(raw);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: b64url(digest) };
}

function parseProxyPaste(s: string): ProxyConfig | null {
	const parts = s.split(":");
	if (parts.length < 4) return null;
	const port = Number(parts[1]);
	if (!Number.isFinite(port)) return null;
	return {
		host: parts[0],
		port,
		username: parts[2],
		password: parts.slice(3).join(":"),
		scheme: "http",
	};
}

onboardRoutes.post("/start", async (c) => {
	const body = await c.req.json<{ proxy: string }>();
	const proxy = parseProxyPaste(body.proxy ?? "");
	if (!proxy) return c.json({ error: "proxy must be ip:port:user:pass" }, 400);
	const { verifier, challenge } = await pkce();
	const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const u = new URL(AUTHORIZE_URL);
	u.searchParams.set("response_type", "code");
	u.searchParams.set("client_id", CLIENT_ID);
	u.searchParams.set("redirect_uri", REDIRECT_URI);
	u.searchParams.set("scope", SCOPE);
	u.searchParams.set("code_challenge", challenge);
	u.searchParams.set("code_challenge_method", "S256");
	u.searchParams.set("state", state);
	u.searchParams.set("code", "true");
	return c.json({
		authorize_url: u.toString().replace(/%20/g, "+"),
		state,
		verifier,
		proxy, // returned so client passes it back verbatim to /complete
	});
});

interface CompletePayload {
	proxy: ProxyConfig;
	state: string;
	verifier: string;
	code: string; // raw code or full callback URL
	email?: string;
	name?: string;
}

function extractCode(input: string, expectedState: string): string {
	const raw = input.trim();
	if (raw.startsWith("http://") || raw.startsWith("https://")) {
		const u = new URL(raw);
		const code = u.searchParams.get("code") ?? "";
		const state = u.searchParams.get("state") ?? "";
		if (state && state !== expectedState) throw new Error("state mismatch");
		return code;
	}
	const hash = raw.indexOf("#");
	if (hash > 0) {
		const state = raw.slice(hash + 1).trim();
		if (state && state !== expectedState) throw new Error("state mismatch");
		return raw.slice(0, hash).trim();
	}
	return raw;
}

onboardRoutes.post("/complete", async (c) => {
	const body = await c.req.json<CompletePayload>();
	if (!body?.proxy?.host || !body?.proxy?.port) return c.json({ error: "proxy required" }, 400);
	let code: string;
	try {
		code = extractCode(body.code, body.state);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
	if (!code) return c.json({ error: "code required" }, 400);

	const tokenReq = new Request(TOKEN_URL, {
		method: "POST",
		headers: {
			"Accept": "application/json, text/plain, */*",
			"Content-Type": "application/json",
			"User-Agent": "axios/1.13.4",
			"Connection": "close",
		},
		body: JSON.stringify({
			client_id: CLIENT_ID,
			code,
			code_verifier: body.verifier,
			grant_type: "authorization_code",
			redirect_uri: REDIRECT_URI,
			state: body.state,
		}),
	});

	let resp: Response;
	try {
		resp = await proxyFetch(c.env, tokenReq, body.proxy);
	} catch (e) {
		return c.json({ error: "token exchange failed", details: (e as Error).message }, 502);
	}
	const text = await resp.text();
	if (!resp.ok) return c.json({ error: "token exchange failed", status: resp.status, body: text }, 502);
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(text);
	} catch {
		return c.json({ error: "non-json token response", body: text }, 502);
	}
	const access = String(raw.access_token ?? "");
	const refresh = String(raw.refresh_token ?? "");
	if (!access || !refresh) return c.json({ error: "missing tokens", body: raw }, 502);
	const expiresIn = Number(raw.expires_in ?? 0);
	const expiresAt = fromTimestampMs(Date.now() + (expiresIn > 0 ? expiresIn * 1000 : 8 * 3600 * 1000));

	const account = (raw.account ?? {}) as Record<string, unknown>;
	const email =
		body.email?.trim() ||
		String(account.email_address ?? raw.email_address ?? raw.email ?? "") ||
		`pending+${Date.now()}@codecmd.com`;

	const proxyId = await upsertProxy(c.env.DB, body.proxy);
	const purchase = nowDate();
	const expire = addDays(purchase, 30);

	const finalEmail = await dedupeEmail(c.env.DB, email);
	const r = await exec(
		c.env.DB,
		`INSERT INTO accounts (
			provider, email, name,
			access_token, access_token_expires_at, refresh_token,
			proxy_id, status, total_capacity, used_count,
			account_level, multiplier,
			purchase_date, expire_date
		) VALUES ('claude', ?, ?, ?, ?, ?, ?, 'active', 10, 0, 1, 1.0, ?, ?)`,
		finalEmail,
		body.name ?? null,
		access,
		expiresAt,
		refresh,
		proxyId,
		purchase,
		expire,
	);

	await audit(c.env.DB, "account.onboard", { type: "account", id: r.lastRowId }, { email: finalEmail, proxyId });
	return c.json({ id: r.lastRowId, email: finalEmail, proxy_id: proxyId, access_token_expires_at: expiresAt });
});

async function upsertProxy(db: D1Database, p: ProxyConfig): Promise<number> {
	const existing = await one<{ id: number }>(
		db,
		`SELECT id FROM proxies WHERE host = ? AND port = ? AND COALESCE(username,'') = COALESCE(?, '')`,
		p.host,
		p.port,
		p.username ?? null,
	);
	if (existing) {
		await run(
			db,
			`UPDATE proxies SET password = ?, scheme = ?, is_active = 1, updated_at = ? WHERE id = ?`,
			p.password ?? null,
			p.scheme ?? "http",
			nowDateTime(),
			existing.id,
		);
		return existing.id;
	}
	const r = await exec(
		db,
		`INSERT INTO proxies (name, host, port, username, password, scheme) VALUES (?, ?, ?, ?, ?, ?)`,
		`${p.host}:${p.port}`,
		p.host,
		p.port,
		p.username ?? null,
		p.password ?? null,
		p.scheme ?? "http",
	);
	return r.lastRowId;
}

async function dedupeEmail(db: D1Database, email: string): Promise<string> {
	let candidate = email;
	let suffix = 0;
	for (;;) {
		const exists = await one<{ id: number }>(db, `SELECT id FROM accounts WHERE email = ? AND deleted_at IS NULL`, candidate);
		if (!exists) return candidate;
		suffix += 1;
		candidate = `${email}${suffix}`;
	}
}

// (proxyConfigToUrl re-exported as a convenience for tests)
export { proxyConfigToUrl };

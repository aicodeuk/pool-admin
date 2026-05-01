// Admin auth: hard-coded password from env (ADMIN_SECRET).
// Issues a signed cookie. No user table.

import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const COOKIE = "pa_session";
const SESSION_TTL_DAYS = 7;

async function hmac(key: string, data: string): Promise<string> {
	const k = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
	return btoa(String.fromCharCode(...new Uint8Array(sig)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

export async function issueSession(c: Context, secret: string): Promise<void> {
	const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 86400;
	const payload = `admin.${exp}`;
	const sig = await hmac(secret, payload);
	const url = new URL(c.req.url);
	const isLocalHttp = url.protocol === "http:";
	setCookie(c, COOKIE, `${payload}.${sig}`, {
		httpOnly: true,
		sameSite: "Lax",
		secure: !isLocalHttp,
		path: "/",
		maxAge: SESSION_TTL_DAYS * 86400,
	});
}

export function clearSession(c: Context): void {
	setCookie(c, COOKIE, "", { path: "/", maxAge: 0 });
}

export async function verifySession(c: Context, secret: string): Promise<boolean> {
	const raw = getCookie(c, COOKIE);
	if (!raw) return false;
	const parts = raw.split(".");
	if (parts.length !== 3) return false;
	const [actor, expStr, sig] = parts;
	if (actor !== "admin") return false;
	const exp = Number(expStr);
	if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
	const expected = await hmac(secret, `${actor}.${expStr}`);
	return constantTimeEqual(sig, expected);
}

export function adminAuth(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		const secret = c.env.ADMIN_SECRET;
		if (!secret) return c.json({ error: "ADMIN_SECRET not configured" }, 500);
		if (!(await verifySession(c, secret))) {
			return c.json({ error: "unauthorized" }, 401);
		}
		await next();
	};
}

// X-API-Signature middleware for v2 sync endpoints (matches original Go service).
export function apiSignature(which: "claude" | "gpt"): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		const expected = which === "claude" ? c.env.API_SECRET_KEY : c.env.GPT_API_SECRET_KEY;
		const sig = c.req.header("X-API-Signature");
		if (!expected || !sig || sig !== expected) {
			return c.json({ error: "invalid signature" }, 401);
		}
		await next();
	};
}

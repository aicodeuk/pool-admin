import { Hono } from "hono";
import { all, exec, one, run } from "../../lib/db";
import { audit } from "../../lib/audit";
import { nowDateTime } from "../../lib/time";
import type { ProxyRow } from "../../lib/types";
import { proxyFetch } from "../../lib/proxy-fetch";

export const proxyRoutes = new Hono<{ Bindings: Env }>();

proxyRoutes.get("/", async (c) => {
	const rows = await all<ProxyRow & { account_count: number }>(
		c.env.DB,
		`SELECT p.*, (SELECT COUNT(*) FROM accounts a WHERE a.proxy_id = p.id AND a.deleted_at IS NULL) AS account_count
		 FROM proxies p ORDER BY p.id ASC`,
	);
	return c.json({ items: rows });
});

proxyRoutes.post("/", async (c) => {
	const body = await c.req.json<Partial<ProxyRow> & { paste?: string }>();
	let { name, host, port, username, password, scheme = "http" } = body as ProxyRow;
	// "ip:port:user:pass" paste shortcut
	if (body.paste) {
		const parts = body.paste.split(":");
		if (parts.length >= 4) {
			host = parts[0];
			port = Number(parts[1]);
			username = parts[2];
			password = parts.slice(3).join(":");
		}
	}
	if (!host || !port) return c.json({ error: "host and port required" }, 400);
	const r = await exec(
		c.env.DB,
		`INSERT INTO proxies (name, host, port, username, password, scheme) VALUES (?, ?, ?, ?, ?, ?)`,
		name ?? null,
		host,
		port,
		username ?? null,
		password ?? null,
		scheme,
	);
	await audit(c.env.DB, "proxy.create", { type: "proxy", id: r.lastRowId }, { host, port, username });
	return c.json({ id: r.lastRowId });
});

proxyRoutes.patch("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const body = await c.req.json<Partial<ProxyRow>>();
	const editable = ["name", "host", "port", "username", "password", "scheme", "is_active"] as const;
	const sets: string[] = [];
	const args: unknown[] = [];
	for (const k of editable) {
		if (k in body) {
			sets.push(`${k} = ?`);
			args.push((body as Record<string, unknown>)[k]);
		}
	}
	if (!sets.length) return c.json({ ok: true });
	sets.push(`updated_at = ?`);
	args.push(nowDateTime());
	args.push(id);
	await run(c.env.DB, `UPDATE proxies SET ${sets.join(", ")} WHERE id = ?`, ...args);
	await audit(c.env.DB, "proxy.update", { type: "proxy", id }, body);
	return c.json({ ok: true });
});

proxyRoutes.delete("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const refs = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM accounts WHERE proxy_id = ? AND deleted_at IS NULL`, id);
	if ((refs?.n ?? 0) > 0) return c.json({ error: `proxy is used by ${refs?.n} accounts` }, 409);
	await run(c.env.DB, `DELETE FROM proxies WHERE id = ?`, id);
	await audit(c.env.DB, "proxy.delete", { type: "proxy", id }, null);
	return c.json({ ok: true });
});

// ipwho.is: free, no auth, returns rich geo info, reliable from CF Workers
const IP_CHECK_URL = "https://ipwho.is/";

proxyRoutes.post("/:id{[0-9]+}/test", async (c) => {
	const id = Number(c.req.param("id"));
	const row = await one<ProxyRow>(c.env.DB, `SELECT * FROM proxies WHERE id = ?`, id);
	if (!row) return c.json({ error: "not found" }, 404);

	const proxy = {
		host: row.host,
		port: row.port,
		username: row.username,
		password: row.password,
		scheme: row.scheme as "http" | "socks5",
	};

	const t0 = Date.now();
	let resp: Response;
	try {
		resp = await proxyFetch(c.env, new Request(IP_CHECK_URL, {
			headers: { "Accept": "application/json", "User-Agent": "curl/8.0" },
		}), proxy);
	} catch (e) {
		return c.json({ ok: false, error: (e as Error).message });
	}
	const latency_ms = Date.now() - t0;

	if (!resp.ok) {
		const body = await resp.text().catch(() => "");
		return c.json({ ok: false, error: `HTTP ${resp.status}`, detail: body.slice(0, 200), latency_ms });
	}

	const text = await resp.text();
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse(text) as Record<string, unknown>;
	} catch {
		return c.json({ ok: false, error: "non-JSON response", body: text.slice(0, 800), latency_ms });
	}

	// ipwho.is returns { ip, country, country_code, city, region, connection: { org, isp } }
	const conn = (raw.connection ?? {}) as Record<string, string>;
	return c.json({
		ok: true,
		ip: String(raw.ip ?? ""),
		city: String(raw.city ?? ""),
		region: String(raw.region ?? ""),
		country: String(raw.country_code ?? raw.country ?? ""),
		org: String(conn.org ?? conn.isp ?? ""),
		latency_ms,
	});
});

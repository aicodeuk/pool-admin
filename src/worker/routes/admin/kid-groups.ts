import { Hono } from "hono";
import { all, run } from "../../lib/db";
import { audit } from "../../lib/audit";
import { nowDateTime } from "../../lib/time";
import type { Provider } from "../../lib/types";

export const kidGroupRoutes = new Hono<{ Bindings: Env }>();

interface KidGroupRow {
	kid: number;
	provider: Provider;
	group_name: string;
	note: string | null;
	created_at: string;
	updated_at: string;
}

const PROVIDERS: Provider[] = ["claude", "gpt", "gemini"];
function isProvider(v: unknown): v is Provider {
	return typeof v === "string" && (PROVIDERS as string[]).includes(v);
}

kidGroupRoutes.get("/", async (c) => {
	const groupName = c.req.query("group_name");
	const provider = c.req.query("provider");
	const where: string[] = [];
	const args: (string | number)[] = [];
	if (groupName) { where.push("group_name = ?"); args.push(groupName); }
	if (provider)  { where.push("provider = ?");   args.push(provider); }
	const sql = `SELECT * FROM kid_groups ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY kid ASC, provider ASC`;
	const rows = await all<KidGroupRow>(c.env.DB, sql, ...args);
	return c.json({ items: rows });
});

kidGroupRoutes.put("/:kid{[0-9]+}/:provider", async (c) => {
	const kid = Number(c.req.param("kid"));
	const provider = c.req.param("provider");
	if (!isProvider(provider)) return c.json({ error: "invalid provider" }, 400);
	const body = await c.req.json<{ group_name: string; note?: string }>();
	if (!body.group_name) return c.json({ error: "group_name required" }, 400);
	await run(
		c.env.DB,
		`INSERT INTO kid_groups (kid, provider, group_name, note) VALUES (?, ?, ?, ?)
		 ON CONFLICT(kid, provider) DO UPDATE SET group_name = excluded.group_name, note = excluded.note, updated_at = ?`,
		kid,
		provider,
		body.group_name,
		body.note?.trim() || null,
		nowDateTime(),
	);
	await audit(c.env.DB, "kid_group.upsert", { type: "kid_group", id: kid }, { provider, ...body });
	return c.json({ ok: true });
});

kidGroupRoutes.delete("/:kid{[0-9]+}/:provider", async (c) => {
	const kid = Number(c.req.param("kid"));
	const provider = c.req.param("provider");
	if (!isProvider(provider)) return c.json({ error: "invalid provider" }, 400);
	await run(c.env.DB, `DELETE FROM kid_groups WHERE kid = ? AND provider = ?`, kid, provider);
	await audit(c.env.DB, "kid_group.delete", { type: "kid_group", id: kid }, { provider });
	return c.json({ ok: true });
});

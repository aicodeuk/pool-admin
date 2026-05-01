import { Hono } from "hono";
import { all, run } from "../../lib/db";
import { audit } from "../../lib/audit";
import { nowDateTime } from "../../lib/time";

export const kidGroupRoutes = new Hono<{ Bindings: Env }>();

interface KidGroupRow {
	kid: number;
	group_name: string;
	note: string | null;
	created_at: string;
	updated_at: string;
}

kidGroupRoutes.get("/", async (c) => {
	const groupName = c.req.query("group_name");
	const rows = groupName
		? await all<KidGroupRow>(c.env.DB, `SELECT * FROM kid_groups WHERE group_name = ? ORDER BY kid ASC`, groupName)
		: await all<KidGroupRow>(c.env.DB, `SELECT * FROM kid_groups ORDER BY kid ASC`);
	return c.json({ items: rows });
});

kidGroupRoutes.put("/:kid{[0-9]+}", async (c) => {
	const kid = Number(c.req.param("kid"));
	const body = await c.req.json<{ group_name: string; note?: string }>();
	if (!body.group_name) return c.json({ error: "group_name required" }, 400);
	await run(
		c.env.DB,
		`INSERT INTO kid_groups (kid, group_name, note) VALUES (?, ?, ?)
		 ON CONFLICT(kid) DO UPDATE SET group_name = excluded.group_name, note = excluded.note, updated_at = ?`,
		kid,
		body.group_name,
		body.note?.trim() || null,
		nowDateTime(),
	);
	await audit(c.env.DB, "kid_group.upsert", { type: "kid_group", id: kid }, body);
	return c.json({ ok: true });
});

kidGroupRoutes.delete("/:kid{[0-9]+}", async (c) => {
	const kid = Number(c.req.param("kid"));
	await run(c.env.DB, `DELETE FROM kid_groups WHERE kid = ?`, kid);
	await audit(c.env.DB, "kid_group.delete", { type: "kid_group", id: kid }, null);
	return c.json({ ok: true });
});

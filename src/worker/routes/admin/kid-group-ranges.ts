import { Hono } from "hono";
import { all, one, run } from "../../lib/db";
import { audit } from "../../lib/audit";
import { nowDateTime } from "../../lib/time";

export const kidGroupRangeRoutes = new Hono<{ Bindings: Env }>();

interface RangeRow {
	id: number;
	kid_from: number;
	kid_to: number;
	group_name: string;
	note: string | null;
	priority: number;
	created_at: string;
	updated_at: string;
}

kidGroupRangeRoutes.get("/", async (c) => {
	const rows = await all<RangeRow>(c.env.DB, `SELECT * FROM kid_group_ranges ORDER BY priority DESC, id ASC`);
	return c.json({ items: rows });
});

kidGroupRangeRoutes.post("/", async (c) => {
	const body = await c.req.json<{ kid_from: number; kid_to: number; group_name: string; note?: string; priority?: number }>();
	if (!body.group_name?.trim()) return c.json({ error: "group_name required" }, 400);
	if (!Number.isFinite(body.kid_from) || !Number.isFinite(body.kid_to)) return c.json({ error: "kid_from / kid_to required" }, 400);
	if (body.kid_to < body.kid_from) return c.json({ error: "kid_to must be >= kid_from" }, 400);

	const ts = nowDateTime();
	const result = await run(
		c.env.DB,
		`INSERT INTO kid_group_ranges (kid_from, kid_to, group_name, note, priority, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		body.kid_from,
		body.kid_to,
		body.group_name.trim(),
		body.note?.trim() || null,
		body.priority ?? 0,
		ts,
		ts,
	);
	const inserted = await one<RangeRow>(c.env.DB, `SELECT * FROM kid_group_ranges WHERE id = ?`, result.meta.last_row_id);
	await audit(c.env.DB, "kid_group_range.create", { type: "kid_group_range", id: result.meta.last_row_id }, body);
	return c.json(inserted, 201);
});

kidGroupRangeRoutes.put("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const body = await c.req.json<{ kid_from?: number; kid_to?: number; group_name?: string; note?: string; priority?: number }>();

	const existing = await one<RangeRow>(c.env.DB, `SELECT * FROM kid_group_ranges WHERE id = ?`, id);
	if (!existing) return c.json({ error: "not found" }, 404);

	const kid_from = body.kid_from ?? existing.kid_from;
	const kid_to   = body.kid_to   ?? existing.kid_to;
	if (kid_to < kid_from) return c.json({ error: "kid_to must be >= kid_from" }, 400);

	await run(
		c.env.DB,
		`UPDATE kid_group_ranges SET kid_from = ?, kid_to = ?, group_name = ?, note = ?, priority = ?, updated_at = ? WHERE id = ?`,
		kid_from,
		kid_to,
		(body.group_name ?? existing.group_name).trim(),
		body.note !== undefined ? (body.note?.trim() || null) : existing.note,
		body.priority ?? existing.priority,
		nowDateTime(),
		id,
	);
	await audit(c.env.DB, "kid_group_range.update", { type: "kid_group_range", id }, body);
	return c.json({ ok: true });
});

kidGroupRangeRoutes.delete("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	await run(c.env.DB, `DELETE FROM kid_group_ranges WHERE id = ?`, id);
	await audit(c.env.DB, "kid_group_range.delete", { type: "kid_group_range", id }, null);
	return c.json({ ok: true });
});

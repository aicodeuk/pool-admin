import { Hono } from "hono";
import { all, one, run } from "../../lib/db";
import { audit } from "../../lib/audit";
import { nowDateTime } from "../../lib/time";

export const kidMappingRoutes = new Hono<{ Bindings: Env }>();

kidMappingRoutes.get("/", async (c) => {
	const provider = c.req.query("provider");
	const kid = c.req.query("kid");
	const where: string[] = [];
	const args: unknown[] = [];
	if (provider) {
		where.push("m.provider = ?");
		args.push(provider);
	}
	if (kid) {
		where.push("m.kid = ?");
		args.push(Number(kid));
	}
	const rows = await all(
		c.env.DB,
		`SELECT m.id, m.kid, m.provider, m.account_id, m.created_at, m.updated_at,
		        a.email, a.group_name, a.tier
		 FROM kid_mappings m LEFT JOIN accounts a ON a.id = m.account_id
		 ${where.length ? "WHERE " + where.join(" AND ") : ""}
		 ORDER BY m.updated_at DESC LIMIT 500`,
		...args,
	);
	return c.json({ items: rows });
});

kidMappingRoutes.delete("/:id{[0-9]+}", async (c) => {
	const id = Number(c.req.param("id"));
	const m = await one<{ account_id: number }>(c.env.DB, `SELECT account_id FROM kid_mappings WHERE id = ?`, id);
	if (!m) return c.json({ error: "not found" }, 404);
	await run(c.env.DB, `DELETE FROM kid_mappings WHERE id = ?`, id);
	await run(c.env.DB, `UPDATE accounts SET used_count = MAX(used_count - 1, 0), updated_at = ? WHERE id = ?`, nowDateTime(), m.account_id);
	await audit(c.env.DB, "kid_mapping.delete", { type: "kid_mapping", id }, null);
	return c.json({ ok: true });
});

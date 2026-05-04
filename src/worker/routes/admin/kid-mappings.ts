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
	const [rows, stats] = await Promise.all([
		all(
			c.env.DB,
			`SELECT m.id, m.kid, m.provider, m.account_id, m.created_at, m.updated_at,
			        a.email, a.group_name, a.tier
			 FROM kid_mappings m LEFT JOIN accounts a ON a.id = m.account_id
			 ${where.length ? "WHERE " + where.join(" AND ") : ""}
			 ORDER BY m.updated_at DESC LIMIT 500`,
			...args,
		),
		one<{ live: number; hour: number; today: number }>(
			c.env.DB,
			`SELECT
			   SUM(CASE WHEN updated_at >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-10 minutes')) THEN 1 ELSE 0 END) AS live,
			   SUM(CASE WHEN updated_at >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-1 hour'))    THEN 1 ELSE 0 END) AS hour,
			   SUM(CASE WHEN updated_at >= strftime('%Y-%m-%d', 'now')                                  THEN 1 ELSE 0 END) AS today
			 FROM kid_mappings`,
		),
	]);
	return c.json({ items: rows, stats: { live: stats?.live ?? 0, hour: stats?.hour ?? 0, today: stats?.today ?? 0 } });
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

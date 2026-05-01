import { Hono } from "hono";
import { all } from "../../lib/db";

export const auditRoutes = new Hono<{ Bindings: Env }>();

auditRoutes.get("/", async (c) => {
	const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
	const targetType = c.req.query("target_type");
	const targetId = c.req.query("target_id");
	const where: string[] = [];
	const args: unknown[] = [];
	if (targetType) {
		where.push("target_type = ?");
		args.push(targetType);
	}
	if (targetId) {
		where.push("target_id = ?");
		args.push(Number(targetId));
	}
	const rows = await all(
		c.env.DB,
		`SELECT * FROM audit_logs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`,
		...args,
		limit,
	);
	return c.json({ items: rows });
});

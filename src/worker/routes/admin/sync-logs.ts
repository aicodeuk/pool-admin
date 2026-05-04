import { Hono } from "hono";
import { all, one } from "../../lib/db";

export const syncLogRoutes = new Hono<{ Bindings: Env }>();

syncLogRoutes.get("/", async (c) => {
	const provider = c.req.query("provider");
	const forceReplace = c.req.query("force_replace");
	const kidStr = c.req.query("kid");
	const aidStr = c.req.query("aid");
	const accountIdStr = c.req.query("account_id");
	const limit = Math.min(Number(c.req.query("limit")) || 200, 1000);
	const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

	const where: string[] = ["created_at >= strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-24 hours'))"];
	const args: unknown[] = [];

	if (provider) { where.push("provider = ?"); args.push(provider); }
	if (forceReplace === "1" || forceReplace === "true") { where.push("force_replace = 1"); }
	else if (forceReplace === "0" || forceReplace === "false") { where.push("force_replace = 0"); }
	if (kidStr) { where.push("kid = ?"); args.push(Number(kidStr)); }
	if (aidStr) { where.push("aid = ?"); args.push(Number(aidStr)); }
	if (accountIdStr) { where.push("assigned_account_id = ?"); args.push(Number(accountIdStr)); }

	const w = where.join(" AND ");
	const rows = await all(c.env.DB, `SELECT * FROM sync_logs WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
	const total = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM sync_logs WHERE ${w}`, ...args);
	return c.json({ items: rows, total: total?.n ?? 0, limit, offset });
});

import { Hono } from "hono";
import { all, one } from "../../lib/db";

export const statsRoutes = new Hono<{ Bindings: Env }>();

statsRoutes.get("/", async (c) => {
	const db = c.env.DB;

	const totals = await all<{ provider: string; status: string; n: number }>(
		db,
		`SELECT provider, status, COUNT(*) AS n
		 FROM accounts WHERE deleted_at IS NULL
		 GROUP BY provider, status`,
	);

	const proxyCount = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM proxies WHERE is_active = 1`);
	const mappingCount = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM kid_mappings`);
	const kidGroupCount = await one<{ n: number }>(db, `SELECT COUNT(DISTINCT group_name) AS n FROM kid_groups`);

	const expiringSoon = await all<{ id: number; provider: string; email: string | null; expire_date: string | null }>(
		db,
		`SELECT id, provider, email, expire_date FROM accounts
		 WHERE deleted_at IS NULL AND expire_date IS NOT NULL
		   AND date(expire_date) <= date('now', '+7 days')
		 ORDER BY expire_date ASC LIMIT 50`,
	);

	const tokenExpiring = await all<{ id: number; provider: string; email: string | null; access_token_expires_at: string | null }>(
		db,
		`SELECT id, provider, email, access_token_expires_at FROM accounts
		 WHERE deleted_at IS NULL AND access_token_expires_at IS NOT NULL
		   AND datetime(access_token_expires_at) <= datetime('now', '+30 minutes')
		 ORDER BY access_token_expires_at ASC LIMIT 50`,
	);

	const highUsage = await all<{ id: number; email: string | null; usage_5h_pct: number | null; usage_7d_pct: number | null }>(
		db,
		`SELECT id, email, usage_5h_pct, usage_7d_pct FROM accounts
		 WHERE provider = 'claude' AND deleted_at IS NULL
		   AND (usage_5h_pct >= 80 OR usage_7d_pct >= 80)
		 ORDER BY COALESCE(usage_7d_pct, 0) DESC LIMIT 20`,
	);

	return c.json({
		totals,
		proxy_count: proxyCount?.n ?? 0,
		group_count: kidGroupCount?.n ?? 0,
		mapping_count: mappingCount?.n ?? 0,
		expiring_soon: expiringSoon,
		token_expiring: tokenExpiring,
		high_usage: highUsage,
	});
});

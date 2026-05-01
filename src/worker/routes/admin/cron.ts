import { Hono } from "hono";
import { all, one, run } from "../../lib/db";
import { nowDateTime } from "../../lib/time";
import { runJob } from "../../cron/log";
import { syncStatus } from "../../cron/status-sync";
import { refreshExpiringTokens } from "../../cron/token-refresh";
import { syncUsage } from "../../cron/usage-sync";

export const cronRoutes = new Hono<{ Bindings: Env }>();

const JOBS = ["status_sync", "token_refresh", "usage_sync"] as const;
type Job = (typeof JOBS)[number];

cronRoutes.get("/", async (c) => {
	const configs = await all<{ job: string; enabled: number; updated_at: string }>(
		c.env.DB,
		`SELECT job, enabled, updated_at FROM cron_config ORDER BY job`,
	);
	const lastRuns = await all<{
		job: string; started_at: string; finished_at: string | null;
		duration_ms: number | null; status: string; result_json: string | null; error_text: string | null;
	}>(
		c.env.DB,
		`SELECT job, started_at, finished_at, duration_ms, status, result_json, error_text
		 FROM cron_logs
		 WHERE id IN (
		   SELECT MAX(id) FROM cron_logs WHERE status != 'running' GROUP BY job
		 )`,
	);
	const lastRunMap = Object.fromEntries(lastRuns.map((r) => [r.job, r]));
	return c.json({ configs: configs.map((cfg) => ({ ...cfg, last_run: lastRunMap[cfg.job] ?? null })) });
});

cronRoutes.get("/logs", async (c) => {
	const job = c.req.query("job");
	const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
	const where = job && JOBS.includes(job as Job) ? `WHERE job = '${job}'` : "";
	const rows = await all(
		c.env.DB,
		`SELECT id, job, started_at, finished_at, duration_ms, status, result_json, error_text
		 FROM cron_logs ${where} ORDER BY id DESC LIMIT ?`,
		limit,
	);
	return c.json({ items: rows });
});

cronRoutes.patch("/:job", async (c) => {
	const job = c.req.param("job");
	if (!JOBS.includes(job as Job)) return c.json({ error: "unknown job" }, 400);
	const body = await c.req.json<{ enabled: boolean }>();
	await run(
		c.env.DB,
		`UPDATE cron_config SET enabled = ?, updated_at = ? WHERE job = ?`,
		body.enabled ? 1 : 0,
		nowDateTime(),
		job,
	);
	return c.json({ ok: true });
});

cronRoutes.post("/:job/run", async (c) => {
	const job = c.req.param("job");
	if (!JOBS.includes(job as Job)) return c.json({ error: "unknown job" }, 400);

	// Temporarily override enabled check — manual trigger always runs
	const cfg = await one<{ enabled: number }>(c.env.DB, `SELECT enabled FROM cron_config WHERE job = ?`, job);
	if (cfg && cfg.enabled === 0) {
		await run(c.env.DB, `UPDATE cron_config SET enabled = 1 WHERE job = ?`, job);
	}

	let result: unknown;
	try {
		if (job === "status_sync") result = await runJob(c.env, job, () => syncStatus(c.env));
		else if (job === "token_refresh") result = await runJob(c.env, job, () => refreshExpiringTokens(c.env));
		else if (job === "usage_sync") result = await runJob(c.env, job, () => syncUsage(c.env));
	} finally {
		// Restore disabled state if it was disabled before
		if (cfg && cfg.enabled === 0) {
			await run(c.env.DB, `UPDATE cron_config SET enabled = 0 WHERE job = ?`, job);
		}
	}
	return c.json({ ok: true, result });
});

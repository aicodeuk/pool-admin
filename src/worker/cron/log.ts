import { exec, one, run } from "../lib/db";
import { nowDateTime } from "../lib/time";

export async function runJob<T>(env: Env, job: string, fn: () => Promise<T>): Promise<T | null> {
	const cfg = await one<{ enabled: number }>(env.DB, `SELECT enabled FROM cron_config WHERE job = ?`, job);
	if (cfg && cfg.enabled === 0) return null;

	const start = Date.now();
	const startedAt = nowDateTime();
	const ins = await exec(
		env.DB,
		`INSERT INTO cron_logs (job, started_at, status) VALUES (?, ?, 'running')`,
		job,
		startedAt,
	);
	const logId = ins.lastRowId;

	try {
		const result = await fn();
		const ms = Date.now() - start;
		await run(
			env.DB,
			`UPDATE cron_logs SET status = 'ok', finished_at = ?, duration_ms = ?, result_json = ? WHERE id = ?`,
			nowDateTime(),
			ms,
			JSON.stringify(result),
			logId,
		);
		return result;
	} catch (e) {
		const ms = Date.now() - start;
		await run(
			env.DB,
			`UPDATE cron_logs SET status = 'error', finished_at = ?, duration_ms = ?, error_text = ? WHERE id = ?`,
			nowDateTime(),
			ms,
			(e as Error).message.slice(0, 500),
			logId,
		);
		throw e;
	}
}

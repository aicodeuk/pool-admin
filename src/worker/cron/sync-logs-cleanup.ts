import { exec } from "../lib/db";

// Enforce sync_logs 24h retention outside the request path.
// Previously a per-INSERT trigger did this on every sync request (see
// migration 0014); it now runs as a scheduled batch delete instead.
export async function cleanupSyncLogs(env: Env): Promise<{ deleted: number }> {
	const { changes } = await exec(
		env.DB,
		`DELETE FROM sync_logs WHERE created_at < strftime('%Y-%m-%d %H:%M:%S', datetime('now', '-24 hours'))`,
	);
	return { deleted: changes };
}

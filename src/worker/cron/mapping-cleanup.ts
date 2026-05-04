import { exec, run } from "../lib/db";
import { nowDateTime } from "../lib/time";

export async function cleanupStaleMappings(env: Env): Promise<{ deleted: number }> {
	const db = env.DB;
	const ts = nowDateTime();

	// Decrement used_count for each affected account before deletion.
	await run(
		db,
		`UPDATE accounts
		 SET used_count = MAX(used_count - (
		   SELECT COUNT(*) FROM kid_mappings
		   WHERE account_id = accounts.id
		     AND updated_at < datetime('now', '-2 hours')
		 ), 0),
		 updated_at = ?
		 WHERE id IN (
		   SELECT DISTINCT account_id FROM kid_mappings
		   WHERE updated_at < datetime('now', '-2 hours')
		 )`,
		ts,
	);

	const { changes } = await exec(
		db,
		`DELETE FROM kid_mappings WHERE updated_at < datetime('now', '-2 hours')`,
	);

	return { deleted: changes };
}

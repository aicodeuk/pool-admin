import type { DB } from "./db";
import { run } from "./db";

export async function audit(
	db: DB,
	action: string,
	target: { type: string; id?: number | null } | null,
	diff?: unknown,
	actor: string = "admin",
): Promise<void> {
	await run(
		db,
		`INSERT INTO audit_logs (actor, action, target_type, target_id, diff_json) VALUES (?, ?, ?, ?, ?)`,
		actor,
		action,
		target?.type ?? null,
		target?.id ?? null,
		diff ? JSON.stringify(diff) : null,
	);
}

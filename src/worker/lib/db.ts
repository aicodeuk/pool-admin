// Thin D1 helpers; keep query call sites short.

export type DB = D1Database;

export async function one<T = Record<string, unknown>>(
	db: DB,
	sql: string,
	...params: unknown[]
): Promise<T | null> {
	const r = await db.prepare(sql).bind(...params).first<T>();
	return r ?? null;
}

export async function all<T = Record<string, unknown>>(
	db: DB,
	sql: string,
	...params: unknown[]
): Promise<T[]> {
	const r = await db.prepare(sql).bind(...params).all<T>();
	return r.results ?? [];
}

export async function run(
	db: DB,
	sql: string,
	...params: unknown[]
): Promise<D1Result> {
	return db.prepare(sql).bind(...params).run();
}

export async function exec(
	db: DB,
	sql: string,
	...params: unknown[]
): Promise<{ lastRowId: number; changes: number }> {
	const r = await db.prepare(sql).bind(...params).run();
	return {
		lastRowId: Number(r.meta?.last_row_id ?? 0),
		changes: r.meta?.changes ?? 0,
	};
}

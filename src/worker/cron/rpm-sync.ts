// Refresh per-account RPM (requests-per-minute) from Elasticsearch, once a minute.
//
// We ask ES for the request count in the last 2 minutes, bucketed by account_id,
// across both the Claude (`claude-*`) and GPT (`request-*`) daily indices, then
// store round(count / 2) as accounts.rpm_current. The scheduler (pick.ts) uses it
// to skip over-limit accounts when assigning a NEW account.

import { run } from "../lib/db";
import { nowDateTime } from "../lib/time";

interface AccountBucket { key: number; doc_count: number }

export async function syncRpm(env: Env): Promise<{ measured: number; cleared: number }> {
	if (!env.ES_URL) return { measured: 0, cleared: 0 };

	const { ES_URL, ES_USERNAME, ES_PASSWORD } = env;
	const auth = btoa(`${ES_USERNAME}:${ES_PASSWORD}`);
	const today = new Date().toISOString().slice(0, 10);
	// Both providers in one query; account_id is globally unique so the terms agg
	// merges counts across indices. Note: right after midnight the 2-min window may
	// span yesterday's index and undercount briefly — acceptable.
	const index = `claude-${today}*,request-${today}*`;

	let buckets: AccountBucket[] = [];
	let res: Response;
	try {
		res = await fetch(`${ES_URL}/${index}/_search`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
			body: JSON.stringify({
				// Docs use `start_time` (UTC, e.g. 2026-06-06T14:41:06Z) as the request
				// timestamp — there is no @timestamp field. `now-2m` is UTC in ES, matching.
				size: 0,
				query: { range: { start_time: { gte: "now-2m" } } },
				aggs: { by_account: { terms: { field: "account_id", size: 5000 } } },
			}),
		});
	} catch (e) {
		throw new Error(`ES request failed: ${(e as Error).message}`);
	}
	if (res.status === 404) {
		buckets = [];
	} else if (!res.ok) {
		throw new Error(`ES ${res.status}: ${(await res.text()).slice(0, 300)}`);
	} else {
		const data = await res.json<{ aggregations?: { by_account?: { buckets?: AccountBucket[] } } }>();
		buckets = data.aggregations?.by_account?.buckets ?? [];
	}

	const ts = nowDateTime();

	// Clear last round's leftovers so accounts that went quiet drop back to 0.
	const clearRes = await run(
		env.DB,
		`UPDATE accounts SET rpm_current = 0, rpm_updated_at = ? WHERE rpm_current != 0 AND deleted_at IS NULL`,
		ts,
	);

	// Write the freshly measured values.
	let measured = 0;
	for (const b of buckets) {
		const rpm = Math.round(b.doc_count / 2);
		if (rpm <= 0) continue;
		await run(
			env.DB,
			`UPDATE accounts SET rpm_current = ?, rpm_updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
			rpm, ts, b.key,
		);
		measured++;
	}

	return { measured, cleared: clearRes.meta?.changes ?? 0 };
}

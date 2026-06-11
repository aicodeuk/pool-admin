// Auto-block "shared session" abusers, once every 10 minutes.
//
// The shared-sessions admin page (es-stats.ts:/shared-sessions) surfaces sessions
// that appear under many api_key_id values today — one person spreading traffic
// across many sub-keys. This job automates the response: any session shared across
// MORE THAN 10 distinct api_key_id values is treated as abuse, and every kid in it
// is bound (provider=claude) to the `channel_abuser` group.
//
// `channel_abuser` deliberately has NO accounts. We do NOT touch the scheduler:
// pick.ts already returns 404 for a `channel_*` group with no available account
// (tryGroupAssign), so binding a kid here makes the sync API fail for it — the key
// can no longer get an account. This job only writes the binding.

import { one, run } from "../lib/db";
import { audit } from "../lib/audit";
import { nowDateTime } from "../lib/time";

const THRESHOLD = 3; // strictly more than 10 keys per session
const MIN_KID = 30000099; // never auto-block kids below this id (reserved range)

interface SessionBucket {
	key: string;
	doc_count: number;
	keys: { value: number };
	key_list: { buckets: { key: number; doc_count: number }[] };
}

export async function blockSessionAbusers(env: Env): Promise<{ flagged: number; blocked: number }> {
	if (!env.ES_URL) return { flagged: 0, blocked: 0 };

	const { ES_URL, ES_USERNAME, ES_PASSWORD } = env;
	const auth = btoa(`${ES_USERNAME}:${ES_PASSWORD}`);
	const today = new Date().toISOString().slice(0, 10);
	const index = `claude-${today}*`;

	let buckets: SessionBucket[] = [];
	let res: Response;
	try {
		res = await fetch(`${ES_URL}/${index}/_search`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
			body: JSON.stringify({
				size: 0,
				query: { bool: { must_not: [{ term: { "session.keyword": "" } }] } },
				aggs: {
					by_session: {
						terms: { field: "session.keyword", size: 200, order: { keys: "desc" } },
						aggs: {
							keys: { cardinality: { field: "api_key_id" } },
							key_list: { terms: { field: "api_key_id", size: 1000, order: { _count: "desc" } } },
						},
					},
				},
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
		const data = await res.json<{ aggregations?: { by_session?: { buckets?: SessionBucket[] } } }>();
		buckets = data.aggregations?.by_session?.buckets ?? [];
	}

	// Sessions shared across MORE THAN 10 keys → collect every kid involved.
	const flagged = buckets.filter((b) => (b.keys?.value ?? 0) > THRESHOLD);
	const kidToCount = new Map<number, number>(); // kid → key_count of the worst session it appeared in
	for (const b of flagged) {
		for (const k of b.key_list?.buckets ?? []) {
			if (k.key < MIN_KID) continue; // exclude reserved low key ids
			const prev = kidToCount.get(k.key) ?? 0;
			if (b.keys.value > prev) kidToCount.set(k.key, b.keys.value);
		}
	}

	let blocked = 0;
	for (const [kid, keyCount] of kidToCount) {
		// Idempotent: skip kids already bound to channel_abuser (no redundant write / audit spam).
		const cur = await one<{ group_name: string }>(
			env.DB,
			`SELECT group_name FROM kid_groups WHERE kid = ? AND provider = 'claude'`,
			kid,
		);
		if (cur?.group_name === "channel_abuser") continue;

		const note = `auto-blocked: session shared across ${keyCount} keys @ ${today}`;
		await run(
			env.DB,
			`INSERT INTO kid_groups (kid, provider, group_name, note) VALUES (?, 'claude', 'channel_abuser', ?)
			 ON CONFLICT(kid, provider) DO UPDATE SET group_name = excluded.group_name, note = excluded.note, updated_at = ?`,
			kid,
			note,
			nowDateTime(),
		);
		await audit(
			env.DB,
			"kid_group.auto_block",
			{ type: "kid_group", id: kid },
			{ provider: "claude", group_name: "channel_abuser", key_count: keyCount, prev_group: cur?.group_name ?? null },
			"cron:session_abuse_block",
		);
		blocked++;
	}

	return { flagged: flagged.length, blocked };
}

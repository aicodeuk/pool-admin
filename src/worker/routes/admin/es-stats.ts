import { Hono } from "hono";
import { all } from "../../lib/db";

export const esStatsRoutes = new Hono<{ Bindings: Env }>();

function indexFor(provider: string, today: string): string | null {
	if (provider === "claude") return `claude-${today}*`;
	if (provider === "gpt") return `request-${today}*`;
	return null;
}

interface IndexStats {
	status_buckets: { key: number; doc_count: number }[];
	model_buckets: {
		key: string;
		doc_count: number;
		input_tokens: { value: number };
		output_tokens: { value: number };
		cache_creation_tokens: { value: number };
		cache_read_tokens: { value: number };
	}[];
	total: number;
}

async function queryIndex(env: Env, index: string): Promise<IndexStats | { error: string }> {
	const { ES_URL, ES_USERNAME, ES_PASSWORD } = env;
	const auth = btoa(`${ES_USERNAME}:${ES_PASSWORD}`);

	let res: Response;
	try {
		res = await fetch(`${ES_URL}/${index}/_search`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Basic ${auth}`,
			},
			body: JSON.stringify({
				size: 0,
				aggs: {
					by_status: { terms: { field: "status_code", size: 20 } },
					by_model: {
						terms: { field: "model.keyword", size: 50 },
						aggs: {
							input_tokens: { sum: { field: "input_tokens" } },
							output_tokens: { sum: { field: "output_tokens" } },
							cache_creation_tokens: { sum: { field: "cache_creation_input_tokens" } },
							cache_read_tokens: { sum: { field: "cache_read_input_tokens" } },
						},
					},
				},
			}),
		});
	} catch (e) {
		return { error: String(e) };
	}

	if (res.status === 404) return { status_buckets: [], model_buckets: [], total: 0 };
	if (!res.ok) return { error: await res.text() };

	const data = await res.json<{
		aggregations: {
			by_status: { buckets: { key: number; doc_count: number }[] };
			by_model: {
				buckets: IndexStats["model_buckets"];
			};
		};
	}>();
	const status_buckets = data.aggregations?.by_status?.buckets ?? [];
	const model_buckets = data.aggregations?.by_model?.buckets ?? [];
	const total = status_buckets.reduce((a, b) => a + b.doc_count, 0);

	return { status_buckets, model_buckets, total };
}

esStatsRoutes.get("/", async (c) => {
	if (!c.env.ES_URL) return c.json({ unconfigured: true });

	const today = new Date().toISOString().slice(0, 10);
	const [claude, gpt] = await Promise.all([
		queryIndex(c.env, `claude-${today}*`),
		queryIndex(c.env, `request-${today}*`),
	]);

	return c.json({ claude, gpt });
});

interface ModelAgg {
	model: string;
	count: number;
	input_tokens: number;
	output_tokens: number;
	cache_creation_tokens: number;
	cache_read_tokens: number;
}

interface AccountAgg {
	account_id: number;
	name: string | null;
	third_party_api_url: string | null;
	total: number;
	models: ModelAgg[];
}

esStatsRoutes.get("/accounts", async (c) => {
	if (!c.env.ES_URL) return c.json({ accounts: [], unconfigured: true });

	const provider = c.req.query("provider") ?? "claude";
	const today = new Date().toISOString().slice(0, 10);
	const index = indexFor(provider, today);
	if (!index) return c.json({ error: "invalid provider" }, 400);

	const { ES_URL, ES_USERNAME, ES_PASSWORD } = c.env;
	const auth = btoa(`${ES_USERNAME}:${ES_PASSWORD}`);

	let res: Response;
	try {
		res = await fetch(`${ES_URL}/${index}/_search`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Basic ${auth}`,
			},
			body: JSON.stringify({
				size: 0,
				query: { term: { status_code: 200 } },
				aggs: {
					by_account: {
						terms: { field: "account_id", size: 1000 },
						aggs: {
							by_model: {
								terms: { field: "model.keyword", size: 50 },
								aggs: {
									input_tokens: { sum: { field: "input_tokens" } },
									output_tokens: { sum: { field: "output_tokens" } },
									cache_creation_tokens: { sum: { field: "cache_creation_input_tokens" } },
									cache_read_tokens: { sum: { field: "cache_read_input_tokens" } },
								},
							},
						},
					},
				},
			}),
		});
	} catch (e) {
		return c.json({ error: String(e) }, 502);
	}

	if (res.status === 404) return c.json({ accounts: [] });
	if (!res.ok) return c.json({ error: await res.text() }, 502);

	const data = await res.json<{
		aggregations: {
			by_account: {
				buckets: {
					key: number;
					doc_count: number;
					by_model: {
						buckets: {
							key: string;
							doc_count: number;
							input_tokens: { value: number };
							output_tokens: { value: number };
							cache_creation_tokens: { value: number };
							cache_read_tokens: { value: number };
						}[];
					};
				}[];
			};
		};
	}>();
	const buckets = data.aggregations?.by_account?.buckets ?? [];

	const info = new Map<number, { name: string | null; third_party_api_url: string | null }>();
	if (buckets.length) {
		const ids = buckets.map((b) => b.key);
		const placeholders = ids.map(() => "?").join(",");
		const rows = await all<{ id: number; name: string | null; third_party_api_url: string | null }>(
			c.env.DB,
			`SELECT id, name, third_party_api_url FROM accounts WHERE id IN (${placeholders})`,
			...ids,
		);
		for (const r of rows) info.set(r.id, { name: r.name, third_party_api_url: r.third_party_api_url });
	}

	const accounts: AccountAgg[] = buckets.map((b) => {
		const meta = info.get(b.key);
		const models: ModelAgg[] = (b.by_model?.buckets ?? []).map((m) => ({
			model: m.key,
			count: m.doc_count,
			input_tokens: m.input_tokens.value,
			output_tokens: m.output_tokens.value,
			cache_creation_tokens: m.cache_creation_tokens.value,
			cache_read_tokens: m.cache_read_tokens.value,
		}));
		return {
			account_id: b.key,
			name: meta?.name ?? null,
			third_party_api_url: meta?.third_party_api_url ?? null,
			total: b.doc_count,
			models,
		};
	});
	accounts.sort((a, b) => b.total - a.total);

	const total = accounts.reduce((s, a) => s + a.total, 0);
	return c.json({ accounts, total });
});

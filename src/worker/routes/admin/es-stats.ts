import { Hono } from "hono";

export const esStatsRoutes = new Hono<{ Bindings: Env }>();

esStatsRoutes.get("/", async (c) => {
	const { ES_URL, ES_USERNAME, ES_PASSWORD } = c.env;
	if (!ES_URL) return c.json({ status_buckets: [], model_buckets: [], total: 0, unconfigured: true });

	const today = new Date().toISOString().slice(0, 10);
	const index = `request-${today}`;
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
		return c.json({ error: String(e) }, 502);
	}

	if (res.status === 404) return c.json({ status_buckets: [], model_buckets: [], total: 0 });
	if (!res.ok) return c.json({ error: await res.text() }, 502);

	const data = await res.json<{
		aggregations: {
			by_status: { buckets: { key: number; doc_count: number }[] };
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
		};
	}>();
	const status_buckets = data.aggregations?.by_status?.buckets ?? [];
	const model_buckets = data.aggregations?.by_model?.buckets ?? [];
	const total = status_buckets.reduce((a, b) => a + b.doc_count, 0);

	return c.json({ status_buckets, model_buckets, total });
});

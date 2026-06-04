import { useEffect, useState, Fragment } from "react";
import { api } from "../lib/api";
import { getModelPricing, calcCost, fmtTokens } from "../lib/pricing";
import { MODEL_COLORS, buildSlices, PieChart } from "../components/PieChart";

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
	success: number;
	error: number;
	error_rate: number;
	models: ModelAgg[];
}

interface AccountStatsResp {
	accounts: AccountAgg[];
	total?: number;
	success?: number;
	error?: number;
	unconfigured?: boolean;
}

const LABEL: Record<string, string> = { claude: "Claude", gpt: "GPT" };

function rateColor(rate: number): string {
	if (rate >= 0.2) return "#dc2626";
	if (rate >= 0.05) return "#f59e0b";
	return "#16a34a";
}

function modelCost(m: ModelAgg): number | null {
	const p = getModelPricing(m.model);
	return p ? calcCost(m, p) : null;
}

function accountCost(a: AccountAgg): number {
	return a.models.reduce((s, m) => s + (modelCost(m) ?? 0), 0);
}

// Merge per-account model rows into one set keyed by model name.
function aggregateModels(accounts: AccountAgg[]): ModelAgg[] {
	const map = new Map<string, ModelAgg>();
	for (const a of accounts) {
		for (const m of a.models) {
			const cur = map.get(m.model);
			if (cur) {
				cur.count += m.count;
				cur.input_tokens += m.input_tokens;
				cur.output_tokens += m.output_tokens;
				cur.cache_creation_tokens += m.cache_creation_tokens;
				cur.cache_read_tokens += m.cache_read_tokens;
			} else {
				map.set(m.model, { ...m });
			}
		}
	}
	return [...map.values()].sort((x, y) => y.count - x.count);
}

function ModelBreakdown({ models, total }: { models: ModelAgg[]; total: number }) {
	const slices = buildSlices(
		models.map((m) => ({ key: m.model, doc_count: m.count })),
		total,
		(_, i) => MODEL_COLORS[i % MODEL_COLORS.length],
	);
	return (
		<div style={{ display: "flex", gap: 32, flexWrap: "wrap", padding: "8px 4px 4px" }}>
			<div>
				<div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>模型调用分布（200）</div>
				<PieChart slices={slices} />
			</div>
			<div style={{ flex: 1, minWidth: 420, overflowX: "auto" }}>
				<table>
					<thead>
						<tr>
							<th>模型</th>
							<th style={{ textAlign: "right" }}>调用次数</th>
							<th style={{ textAlign: "right" }}>Input</th>
							<th style={{ textAlign: "right" }}>Cache Write</th>
							<th style={{ textAlign: "right" }}>Cache Read</th>
							<th style={{ textAlign: "right" }}>Output</th>
							<th style={{ textAlign: "right" }}>费用 ($)</th>
						</tr>
					</thead>
					<tbody>
						{models.map((m, i) => {
							const cost = modelCost(m);
							return (
								<tr key={i}>
									<td>
										<span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: MODEL_COLORS[i % MODEL_COLORS.length], marginRight: 6 }} />
										<span className="mono" style={{ fontSize: 12 }}>{m.model}</span>
									</td>
									<td style={{ textAlign: "right" }}>{m.count.toLocaleString()}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(m.input_tokens)}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(m.cache_creation_tokens)}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(m.cache_read_tokens)}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(m.output_tokens)}</td>
									<td style={{ textAlign: "right", fontWeight: 600 }}>{cost != null ? `$${cost.toFixed(4)}` : <span className="muted">—</span>}</td>
								</tr>
							);
						})}
					</tbody>
					{models.length > 1 && (
						<tfoot>
							<tr style={{ borderTop: "1px solid #e2e8f0" }}>
								<td style={{ textAlign: "right", color: "#6b7280", paddingTop: 8 }}>合计</td>
								<td style={{ textAlign: "right", paddingTop: 8 }}>{total.toLocaleString()}</td>
								<td colSpan={4} />
								<td style={{ textAlign: "right", fontWeight: 700, paddingTop: 8 }}>${models.reduce((s, m) => s + (modelCost(m) ?? 0), 0).toFixed(4)}</td>
							</tr>
						</tfoot>
					)}
				</table>
			</div>
		</div>
	);
}

export function AccountStats({ provider }: { provider: "claude" | "gpt" }) {
	const [data, setData] = useState<AccountStatsResp | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<number>>(new Set());

	useEffect(() => {
		setData(null);
		setError(null);
		setExpanded(new Set());
		api.get<AccountStatsResp>(`/api/admin/es-stats/accounts?provider=${provider}`)
			.then(setData)
			.catch((e) => setError((e as Error).message));
	}, [provider]);

	if (error) return <div className="error">{error}</div>;
	if (!data) return <div className="muted">加载中…</div>;

	const today = new Date().toISOString().slice(0, 10);

	function toggle(id: number) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	const rows = data.accounts.map((a) => ({ a, cost: accountCost(a) }));
	const totalCost = rows.reduce((s, r) => s + r.cost, 0);
	const overallRate = data.total ? (data.error ?? 0) / data.total : 0;
	const aggModels = aggregateModels(data.accounts);

	return (
		<>
			<h2>{LABEL[provider]} 账号调用统计（{today}）</h2>

			{data.unconfigured ? (
				<div className="card"><div className="muted">未配置 Elasticsearch（ES_URL）。</div></div>
			) : (
				<>
					<div className="stats">
						<div className="stat">
							<div className="label">总请求</div>
							<div className="value">{(data.total ?? 0).toLocaleString()}</div>
						</div>
						<div className="stat">
							<div className="label">成功 (200)</div>
							<div className="value" style={{ color: "#16a34a" }}>{(data.success ?? 0).toLocaleString()}</div>
						</div>
						<div className="stat">
							<div className="label">错误 (非200)</div>
							<div className="value" style={{ color: (data.error ?? 0) > 0 ? "#dc2626" : undefined }}>{(data.error ?? 0).toLocaleString()}</div>
						</div>
						<div className="stat">
							<div className="label">总错误率</div>
							<div className="value" style={{ color: rateColor(overallRate) }}>{(overallRate * 100).toFixed(1)}%</div>
						</div>
						<div className="stat">
							<div className="label">账号数</div>
							<div className="value">{data.accounts.length}</div>
						</div>
						<div className="stat">
							<div className="label">总费用（官方价）</div>
							<div className="value" style={{ color: "#111" }}>${totalCost.toFixed(2)}</div>
						</div>
					</div>

					<div className="card" style={{ marginTop: 16 }}>
						<h3 style={{ marginTop: 0 }}>
							全部模型调用分布与费用明细（200）
							<span style={{ marginLeft: 12, fontSize: 14, fontWeight: 400, color: "#6b7280" }}>
								合计 <span style={{ color: "#111", fontWeight: 600 }}>${totalCost.toFixed(4)}</span>
							</span>
						</h3>
						{aggModels.length === 0
							? <div className="muted">暂无数据</div>
							: <ModelBreakdown models={aggModels} total={data.success ?? 0} />}
					</div>

					<div className="card" style={{ marginTop: 16 }}>
						<h3 style={{ marginTop: 0 }}>按账号（点击行展开模型明细）</h3>
						{rows.length === 0 ? (
							<div className="muted">暂无数据</div>
						) : (
							<div style={{ overflowX: "auto" }}>
								<table>
									<thead>
										<tr>
											<th style={{ width: 28 }}></th>
											<th>account_id</th>
											<th>名称</th>
											<th>API 地址</th>
											<th style={{ textAlign: "right" }}>成功 (200)</th>
											<th style={{ textAlign: "right" }}>错误 (非200)</th>
											<th style={{ textAlign: "right" }}>总计</th>
											<th style={{ textAlign: "right" }}>错误率</th>
											<th style={{ textAlign: "right" }}>费用 ($)</th>
										</tr>
									</thead>
									<tbody>
										{rows.map(({ a, cost }) => {
											const open = expanded.has(a.account_id);
											return (
												<Fragment key={a.account_id}>
													<tr style={{ cursor: "pointer" }} onClick={() => toggle(a.account_id)}>
														<td style={{ color: "#6b7280" }}>{open ? "▾" : "▸"}</td>
														<td className="mono">{a.account_id}</td>
														<td>{a.name ?? <span className="muted">-</span>}</td>
														<td className="mono" style={{ fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.third_party_api_url ?? <span className="muted">官方</span>}</td>
														<td style={{ textAlign: "right" }} className="mono">{a.success.toLocaleString()}</td>
														<td style={{ textAlign: "right", color: a.error > 0 ? "#dc2626" : undefined }} className="mono">{a.error.toLocaleString()}</td>
														<td style={{ textAlign: "right" }} className="mono">{a.total.toLocaleString()}</td>
														<td style={{ textAlign: "right", fontWeight: 600, color: rateColor(a.error_rate) }}>{(a.error_rate * 100).toFixed(1)}%</td>
														<td style={{ textAlign: "right", fontWeight: 600 }}>${cost.toFixed(4)}</td>
													</tr>
													{open && (
														<tr>
															<td colSpan={9} style={{ background: "#f8fafc" }}>
																<ModelBreakdown models={a.models} total={a.success} />
															</td>
														</tr>
													)}
												</Fragment>
											);
										})}
									</tbody>
									<tfoot>
										<tr style={{ borderTop: "1px solid #e2e8f0" }}>
											<td colSpan={4} style={{ textAlign: "right", color: "#6b7280", paddingTop: 8 }}>合计</td>
											<td style={{ textAlign: "right", paddingTop: 8 }} className="mono">{(data.success ?? 0).toLocaleString()}</td>
											<td style={{ textAlign: "right", paddingTop: 8 }} className="mono">{(data.error ?? 0).toLocaleString()}</td>
											<td style={{ textAlign: "right", paddingTop: 8 }} className="mono">{(data.total ?? 0).toLocaleString()}</td>
											<td style={{ textAlign: "right", paddingTop: 8, color: rateColor(overallRate) }}>{(overallRate * 100).toFixed(1)}%</td>
											<td style={{ textAlign: "right", fontWeight: 700, paddingTop: 8 }}>${totalCost.toFixed(4)}</td>
										</tr>
									</tfoot>
								</table>
							</div>
						)}
					</div>
				</>
			)}
		</>
	);
}

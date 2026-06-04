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
	models: ModelAgg[];
}

interface AccountStatsResp {
	accounts: AccountAgg[];
	total?: number;
	unconfigured?: boolean;
}

const LABEL: Record<string, string> = { claude: "Claude", gpt: "GPT" };

function modelCost(m: ModelAgg): number | null {
	const p = getModelPricing(m.model);
	return p ? calcCost(m, p) : null;
}

function accountCost(a: AccountAgg): number {
	return a.models.reduce((s, m) => s + (modelCost(m) ?? 0), 0);
}

function ModelBreakdown({ a }: { a: AccountAgg }) {
	const slices = buildSlices(
		a.models.map((m) => ({ key: m.model, doc_count: m.count })),
		a.total,
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
						{a.models.map((m, i) => {
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

	return (
		<>
			<h2>{LABEL[provider]} 账号调用统计（{today}，仅 200）</h2>

			{data.unconfigured ? (
				<div className="card"><div className="muted">未配置 Elasticsearch（ES_URL）。</div></div>
			) : (
				<>
					<div className="stats">
						<div className="stat">
							<div className="label">总调用（200）</div>
							<div className="value">{(data.total ?? 0).toLocaleString()}</div>
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
											<th style={{ textAlign: "right" }}>调用次数</th>
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
														<td style={{ textAlign: "right" }}>{a.total.toLocaleString()}</td>
														<td style={{ textAlign: "right", fontWeight: 600 }}>${cost.toFixed(4)}</td>
													</tr>
													{open && (
														<tr>
															<td colSpan={6} style={{ background: "#f8fafc" }}>
																<ModelBreakdown a={a} />
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
											<td style={{ textAlign: "right", paddingTop: 8 }}>{(data.total ?? 0).toLocaleString()}</td>
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

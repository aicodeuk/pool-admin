import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { getModelPricing, calcCost, fmtTokens, type ModelTokens } from "../lib/pricing";

interface ModelAgg extends ModelTokens {
	model: string;
	count: number;
}

interface KeyAgg {
	api_key_id: number;
	count: number;
	sessions: number;
	models: ModelAgg[];
}

interface RiskResp {
	keys: KeyAgg[];
	unconfigured?: boolean;
}

function keyCost(k: KeyAgg): number {
	return k.models.reduce((s, m) => {
		const p = getModelPricing(m.model);
		return s + (p ? calcCost(m, p) : 0);
	}, 0);
}

function sumTok(k: KeyAgg, field: keyof ModelTokens): number {
	return k.models.reduce((s, m) => s + m[field], 0);
}

export function Risk() {
	const [data, setData] = useState<RiskResp | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api.get<RiskResp>("/api/admin/es-stats/risk")
			.then(setData)
			.catch((e) => setError((e as Error).message));
	}, []);

	if (error) return <div className="error">{error}</div>;
	if (!data) return <div className="muted">加载中…</div>;

	const today = new Date().toISOString().slice(0, 10);
	const rows = data.keys.map((k) => ({ k, cost: keyCost(k) }));
	const totalCost = rows.reduce((s, r) => s + r.cost, 0);
	const totalReq = rows.reduce((s, r) => s + r.k.count, 0);
	const totalSessions = rows.reduce((s, r) => s + r.k.sessions, 0);

	return (
		<>
			<h2>风险分析 · API Key 排名（Claude，{today}）</h2>

			{data.unconfigured ? (
				<div className="card"><div className="muted">未配置 Elasticsearch（ES_URL）。</div></div>
			) : (
				<>
					<div className="stats">
						<div className="stat">
							<div className="label">Top {data.keys.length} Key 请求数</div>
							<div className="value">{totalReq.toLocaleString()}</div>
						</div>
						<div className="stat">
							<div className="label">折算费用（原价）</div>
							<div className="value" style={{ color: "#111" }}>${totalCost.toFixed(2)}</div>
						</div>
					</div>

					<div className="card" style={{ marginTop: 16 }}>
						<h3 style={{ marginTop: 0 }}>请求次数最多的 Key（前 50）</h3>
						{rows.length === 0 ? (
							<div className="muted">暂无数据</div>
						) : (
							<div style={{ overflowX: "auto" }}>
								<table>
									<thead>
										<tr>
											<th style={{ textAlign: "right", width: 48 }}>#</th>
											<th>api_key_id</th>
											<th style={{ textAlign: "right" }}>请求次数</th>
											<th style={{ textAlign: "right" }}>会话数</th>
											<th style={{ textAlign: "right" }}>Input</th>
											<th style={{ textAlign: "right" }}>Cache Write</th>
											<th style={{ textAlign: "right" }}>Cache Read</th>
											<th style={{ textAlign: "right" }}>Output</th>
											<th style={{ textAlign: "right" }}>费用 ($)</th>
										</tr>
									</thead>
									<tbody>
										{rows.map(({ k, cost }, i) => (
											<tr key={k.api_key_id}>
												<td style={{ textAlign: "right", color: i < 3 ? "#dc2626" : "#6b7280", fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</td>
												<td className="mono">{k.api_key_id}</td>
												<td style={{ textAlign: "right", fontWeight: 600 }}>{k.count.toLocaleString()}</td>
												<td style={{ textAlign: "right" }} className="mono">{k.sessions.toLocaleString()}</td>
												<td style={{ textAlign: "right" }} className="mono">{fmtTokens(sumTok(k, "input_tokens"))}</td>
												<td style={{ textAlign: "right" }} className="mono">{fmtTokens(sumTok(k, "cache_creation_tokens"))}</td>
												<td style={{ textAlign: "right" }} className="mono">{fmtTokens(sumTok(k, "cache_read_tokens"))}</td>
												<td style={{ textAlign: "right" }} className="mono">{fmtTokens(sumTok(k, "output_tokens"))}</td>
												<td style={{ textAlign: "right", fontWeight: 600 }}>${cost.toFixed(4)}</td>
											</tr>
										))}
									</tbody>
									<tfoot>
										<tr style={{ borderTop: "1px solid #e2e8f0" }}>
											<td colSpan={2} style={{ textAlign: "right", color: "#6b7280", paddingTop: 8 }}>合计</td>
											<td style={{ textAlign: "right", fontWeight: 700, paddingTop: 8 }}>{totalReq.toLocaleString()}</td>
											<td style={{ textAlign: "right", paddingTop: 8 }} className="mono">{totalSessions.toLocaleString()}</td>
											<td colSpan={4} />
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

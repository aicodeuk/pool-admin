import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface AccountAgg {
	account_id: number;
	email: string | null;
	total: number;
	success: number;
	error: number;
	error_rate: number;
}

interface AccountStatsResp {
	accounts: AccountAgg[];
	total?: number;
	success?: number;
	error?: number;
	unconfigured?: boolean;
}

function rateColor(rate: number): string {
	if (rate >= 0.2) return "#dc2626";
	if (rate >= 0.05) return "#f59e0b";
	return "#16a34a";
}

const LABEL: Record<string, string> = { claude: "Claude", gpt: "GPT" };

export function AccountStats({ provider }: { provider: "claude" | "gpt" }) {
	const [data, setData] = useState<AccountStatsResp | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setData(null);
		setError(null);
		api.get<AccountStatsResp>(`/api/admin/es-stats/accounts?provider=${provider}`)
			.then(setData)
			.catch((e) => setError((e as Error).message));
	}, [provider]);

	if (error) return <div className="error">{error}</div>;
	if (!data) return <div className="muted">加载中…</div>;

	const today = new Date().toISOString().slice(0, 10);
	const overallRate = data.total ? (data.error ?? 0) / data.total : 0;

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
					</div>

					<div className="card" style={{ marginTop: 16 }}>
						<h3 style={{ marginTop: 0 }}>按账号</h3>
						{data.accounts.length === 0 ? (
							<div className="muted">暂无数据</div>
						) : (
							<div style={{ overflowX: "auto" }}>
								<table>
									<thead>
										<tr>
											<th>account_id</th>
											<th>邮箱</th>
											<th style={{ textAlign: "right" }}>成功 (200)</th>
											<th style={{ textAlign: "right" }}>错误 (非200)</th>
											<th style={{ textAlign: "right" }}>总计</th>
											<th style={{ textAlign: "right" }}>错误率</th>
										</tr>
									</thead>
									<tbody>
										{data.accounts.map((a) => (
											<tr key={a.account_id}>
												<td className="mono">{a.account_id}</td>
												<td>{a.email ?? <span className="muted">-</span>}</td>
												<td style={{ textAlign: "right" }} className="mono">{a.success.toLocaleString()}</td>
												<td style={{ textAlign: "right", color: a.error > 0 ? "#dc2626" : undefined }} className="mono">{a.error.toLocaleString()}</td>
												<td style={{ textAlign: "right" }} className="mono">{a.total.toLocaleString()}</td>
												<td style={{ textAlign: "right", fontWeight: 600, color: rateColor(a.error_rate) }}>{(a.error_rate * 100).toFixed(1)}%</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</>
			)}
		</>
	);
}

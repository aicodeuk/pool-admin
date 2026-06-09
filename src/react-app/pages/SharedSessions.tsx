import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface SharedSession {
	session: string;
	key_count: number;
	requests: number;
	keys: { api_key_id: number; count: number }[];
}

interface Resp {
	sessions: SharedSession[];
	unconfigured?: boolean;
}

export function SharedSessions() {
	const [data, setData] = useState<Resp | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api.get<Resp>("/api/admin/es-stats/shared-sessions")
			.then(setData)
			.catch((e) => setError((e as Error).message));
	}, []);

	if (error) return <div className="error">{error}</div>;
	if (!data) return <div className="muted">加载中…</div>;

	const today = new Date().toISOString().slice(0, 10);
	const sessions = data.sessions;

	return (
		<>
			<h2>多号检测 · 跨 Key 共享会话（Claude，{today}）</h2>
			<p className="muted" style={{ marginTop: -8 }}>
				同一个 session 出现在多个 api_key_id 下,可能是同一人用多个小号分摊流量。按关联 Key 数从多到少排列。
			</p>

			{data.unconfigured ? (
				<div className="card"><div className="muted">未配置 Elasticsearch（ES_URL）。</div></div>
			) : (
				<div className="card" style={{ marginTop: 16 }}>
					<h3 style={{ marginTop: 0 }}>可疑会话（关联 ≥ 2 个 Key）</h3>
					{sessions.length === 0 ? (
						<div className="muted">未发现跨 Key 共享的会话 🎉</div>
					) : (
						<div style={{ overflowX: "auto" }}>
							<table>
								<thead>
									<tr>
										<th style={{ textAlign: "right", width: 48 }}>#</th>
										<th>session</th>
										<th style={{ textAlign: "right" }}>关联 Key 数</th>
										<th style={{ textAlign: "right" }}>总请求</th>
										<th>api_key_id（请求数）</th>
									</tr>
								</thead>
								<tbody>
									{sessions.map((s, i) => (
										<tr key={s.session}>
											<td style={{ textAlign: "right", color: s.key_count >= 3 ? "#dc2626" : "#6b7280", fontWeight: s.key_count >= 3 ? 700 : 400 }}>{i + 1}</td>
											<td className="mono" style={{ fontSize: 12 }}>{s.session}</td>
											<td style={{ textAlign: "right", fontWeight: 700, color: s.key_count >= 3 ? "#dc2626" : "#f59e0b" }}>{s.key_count}</td>
											<td style={{ textAlign: "right" }} className="mono">{s.requests.toLocaleString()}</td>
											<td>
												<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
													{s.keys.map((k) => (
														<span key={k.api_key_id} className="mono" style={{ fontSize: 12, background: "#f1f5f9", borderRadius: 4, padding: "1px 6px" }}>
															{k.api_key_id} <span style={{ color: "#6b7280" }}>({k.count})</span>
														</span>
													))}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</>
	);
}

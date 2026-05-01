import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Stats {
	totals: { provider: string; status: string; n: number }[];
	proxy_count: number;
	group_count: number;
	mapping_count: number;
	expiring_soon: { id: number; provider: string; email: string | null; expire_date: string | null }[];
	token_expiring: { id: number; provider: string; email: string | null; access_token_expires_at: string | null }[];
	high_usage: { id: number; email: string | null; usage_5h_pct: number | null; usage_7d_pct: number | null }[];
}

export function Dashboard() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api.get<Stats>("/api/admin/stats").then(setStats).catch((e) => setError((e as Error).message));
	}, []);

	if (error) return <div className="error">{error}</div>;
	if (!stats) return <div className="muted">加载中…</div>;

	const byProvider = (provider: string) => stats.totals.filter((t) => t.provider === provider);
	const sumOf = (provider: string) => byProvider(provider).reduce((a, b) => a + b.n, 0);
	const activeOf = (provider: string) =>
		byProvider(provider).find((t) => t.status === "active")?.n ?? 0;

	return (
		<>
			<h2>仪表盘</h2>
			<div className="stats">
				{(["claude", "gpt", "gemini"] as const).map((p) => (
					<div className="stat" key={p}>
						<div className="label">{p}</div>
						<div className="value">{activeOf(p)} <span className="muted" style={{ fontSize: 14 }}>/ {sumOf(p)}</span></div>
						<div className="sub">活跃 / 总数</div>
					</div>
				))}
				<div className="stat">
					<div className="label">代理</div>
					<div className="value">{stats.proxy_count}</div>
				</div>
				<div className="stat">
					<div className="label">分组</div>
					<div className="value">{stats.group_count}</div>
				</div>
				<div className="stat">
					<div className="label">Kid 映射</div>
					<div className="value">{stats.mapping_count}</div>
				</div>
			</div>

			<div className="row" style={{ alignItems: "stretch", marginTop: 16 }}>
				<div className="card grow">
					<h3 style={{ marginTop: 0 }}>账号即将到期（7 天内）</h3>
					{stats.expiring_soon.length === 0 ? (
						<div className="muted">暂无</div>
					) : (
						<table>
							<thead><tr><th>ID</th><th>渠道</th><th>邮箱</th><th>到期日</th></tr></thead>
							<tbody>
								{stats.expiring_soon.map((r) => (
									<tr key={r.id}><td>{r.id}</td><td>{r.provider}</td><td>{r.email}</td><td>{r.expire_date}</td></tr>
								))}
							</tbody>
						</table>
					)}
				</div>
				<div className="card grow">
					<h3 style={{ marginTop: 0 }}>Token 即将过期（30 分钟内）</h3>
					{stats.token_expiring.length === 0 ? (
						<div className="muted">暂无</div>
					) : (
						<table>
							<thead><tr><th>ID</th><th>渠道</th><th>邮箱</th><th>过期时间</th></tr></thead>
							<tbody>
								{stats.token_expiring.map((r) => (
									<tr key={r.id}><td>{r.id}</td><td>{r.provider}</td><td>{r.email}</td><td className="mono">{r.access_token_expires_at}</td></tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</div>

			<div className="card">
				<h3 style={{ marginTop: 0 }}>用量超 80%（Claude）</h3>
				{stats.high_usage.length === 0 ? (
					<div className="muted">暂无</div>
				) : (
					<table>
						<thead><tr><th>ID</th><th>邮箱</th><th>5h</th><th>7d</th></tr></thead>
						<tbody>
							{stats.high_usage.map((r) => (
								<tr key={r.id}>
									<td>{r.id}</td><td>{r.email}</td>
									<td>{r.usage_5h_pct?.toFixed(1) ?? "-"}%</td>
									<td>{r.usage_7d_pct?.toFixed(1) ?? "-"}%</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</>
	);
}

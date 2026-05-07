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

interface EsBucket {
	key: number;
	doc_count: number;
}

interface EsStats {
	buckets: EsBucket[];
	total: number;
	unconfigured?: boolean;
}

function statusColor(code: number): string {
	if (code === 200) return "#16a34a";
	if (code >= 200 && code < 300) return "#4ade80";
	if (code >= 400 && code < 500) return "#f59e0b";
	if (code >= 500) return "#dc2626";
	return "#6b7280";
}

function PieChart({ buckets, total }: { buckets: EsBucket[]; total: number }) {
	if (total === 0) return <div className="muted" style={{ padding: "24px 0" }}>暂无数据</div>;

	const cx = 90, cy = 90, r = 76;
	let angle = -Math.PI / 2;

	const slices = buckets.map((b) => {
		const frac = b.doc_count / total;
		const start = angle;
		const end = angle + frac * 2 * Math.PI;
		angle = end;
		const x1 = cx + r * Math.cos(start);
		const y1 = cy + r * Math.sin(start);
		const x2 = cx + r * Math.cos(end);
		const y2 = cy + r * Math.sin(end);
		const large = frac > 0.5 ? 1 : 0;
		return { key: b.key, count: b.doc_count, frac, color: statusColor(b.key), path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z` };
	});

	return (
		<div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
			<svg viewBox="0 0 180 180" width={160} height={160} style={{ flexShrink: 0 }}>
				{slices.map((s) => (
					<path key={s.key} d={s.path} fill={s.color}>
						<title>{s.key}: {s.count} ({(s.frac * 100).toFixed(1)}%)</title>
					</path>
				))}
			</svg>
			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				{slices.map((s) => (
					<div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
						<span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
						<span className="mono" style={{ minWidth: 36 }}>{s.key}</span>
						<span style={{ color: "#6b7280" }}>{s.count.toLocaleString()}</span>
						<span style={{ color: "#9ca3af", fontSize: 11 }}>({(s.frac * 100).toFixed(1)}%)</span>
					</div>
				))}
			</div>
		</div>
	);
}

export function Dashboard() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [esStats, setEsStats] = useState<EsStats | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api.get<Stats>("/api/admin/stats").then(setStats).catch((e) => setError((e as Error).message));
		api.get<EsStats>("/api/admin/es-stats").then(setEsStats).catch(() => null);
	}, []);

	if (error) return <div className="error">{error}</div>;
	if (!stats) return <div className="muted">加载中…</div>;

	const byProvider = (provider: string) => stats.totals.filter((t) => t.provider === provider);
	const sumOf = (provider: string) => byProvider(provider).reduce((a, b) => a + b.n, 0);
	const activeOf = (provider: string) =>
		byProvider(provider).find((t) => t.status === "active")?.n ?? 0;

	const successCount = esStats?.buckets.find((b) => b.key === 200)?.doc_count ?? 0;
	const errorCount = esStats ? (esStats.total - successCount) : 0;
	const successRate = esStats && esStats.total > 0 ? (successCount / esStats.total * 100).toFixed(1) : null;

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

			{esStats && !esStats.unconfigured && (
				<div className="card" style={{ marginTop: 16 }}>
					<h3 style={{ marginTop: 0 }}>今日请求统计（{new Date().toISOString().slice(0, 10)}）</h3>
					<div className="stats" style={{ marginBottom: 20 }}>
						<div className="stat">
							<div className="label">成功 (200)</div>
							<div className="value" style={{ color: "#16a34a" }}>{successCount.toLocaleString()}</div>
							{successRate && <div className="sub">{successRate}%</div>}
						</div>
						<div className="stat">
							<div className="label">异常 (&gt;200)</div>
							<div className="value" style={{ color: errorCount > 0 ? "#dc2626" : undefined }}>{errorCount.toLocaleString()}</div>
							{esStats.total > 0 && <div className="sub">{(errorCount / esStats.total * 100).toFixed(1)}%</div>}
						</div>
						<div className="stat">
							<div className="label">总计</div>
							<div className="value">{esStats.total.toLocaleString()}</div>
						</div>
					</div>
					<PieChart buckets={esStats.buckets} total={esStats.total} />
				</div>
			)}

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

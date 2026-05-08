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

interface EsStats {
	status_buckets: { key: number; doc_count: number }[];
	model_buckets: { key: string; doc_count: number }[];
	total: number;
	unconfigured?: boolean;
}

// Distinct color palette for models
const MODEL_COLORS = [
	"#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#ec4899",
	"#14b8a6", "#f97316", "#8b5cf6", "#06b6d4", "#84cc16",
	"#ef4444", "#a78bfa", "#fb923c", "#34d399", "#60a5fa",
];

function statusColor(code: number): string {
	if (code === 200) return "#16a34a";
	if (code >= 200 && code < 300) return "#4ade80";
	if (code >= 400 && code < 500) return "#f59e0b";
	if (code >= 500) return "#dc2626";
	return "#6b7280";
}

interface Slice {
	key: string | number;
	count: number;
	frac: number;
	color: string;
	path: string;
}

function buildSlices(
	buckets: { key: string | number; doc_count: number }[],
	total: number,
	colorFn: (key: string | number, i: number) => string,
): Slice[] {
	const cx = 90, cy = 90, r = 76;
	let angle = -Math.PI / 2;
	return buckets.map((b, i) => {
		const frac = b.doc_count / total;
		const start = angle;
		const end = angle + frac * 2 * Math.PI;
		angle = end;
		const x1 = cx + r * Math.cos(start);
		const y1 = cy + r * Math.sin(start);
		const x2 = cx + r * Math.cos(end);
		const y2 = cy + r * Math.sin(end);
		return { key: b.key, count: b.doc_count, frac, color: colorFn(b.key, i), path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2},${y2} Z` };
	});
}

function PieChart({ slices }: { slices: Slice[] }) {
	return (
		<div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
			<svg viewBox="0 0 180 180" width={160} height={160} style={{ flexShrink: 0 }}>
				{slices.map((s, i) => (
					<path key={i} d={s.path} fill={s.color}>
						<title>{s.key}: {s.count.toLocaleString()} ({(s.frac * 100).toFixed(1)}%)</title>
					</path>
				))}
			</svg>
			<div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 200, flexWrap: "wrap", columnGap: 24 }}>
				{slices.map((s, i) => (
					<div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
						<span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
						<span className="mono" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.key}</span>
						<span style={{ color: "#6b7280", flexShrink: 0 }}>{s.count.toLocaleString()}</span>
						<span style={{ color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>({(s.frac * 100).toFixed(1)}%)</span>
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

	const showEs = esStats && !esStats.unconfigured;
	const successCount = esStats?.status_buckets.find((b) => b.key === 200)?.doc_count ?? 0;
	const errorCount = esStats ? (esStats.total - successCount) : 0;

	const statusSlices = showEs ? buildSlices(esStats.status_buckets, esStats.total, (key) => statusColor(key as number)) : [];
	const modelSlices = showEs ? buildSlices(esStats.model_buckets, esStats.model_buckets.reduce((a, b) => a + b.doc_count, 0), (_, i) => MODEL_COLORS[i % MODEL_COLORS.length]) : [];

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

			{showEs && (
				<>
					<div className="row" style={{ alignItems: "stretch", marginTop: 16 }}>
						<div className="card grow">
							<h3 style={{ marginTop: 0 }}>今日状态码分布（{new Date().toISOString().slice(0, 10)}）</h3>
							<div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
								<div>
									<div style={{ fontSize: 12, color: "#6b7280" }}>成功 (200)</div>
									<div style={{ fontSize: 22, fontWeight: 600, color: "#16a34a" }}>{successCount.toLocaleString()}</div>
								</div>
								<div>
									<div style={{ fontSize: 12, color: "#6b7280" }}>异常 (&gt;200)</div>
									<div style={{ fontSize: 22, fontWeight: 600, color: errorCount > 0 ? "#dc2626" : undefined }}>{errorCount.toLocaleString()}</div>
								</div>
								<div>
									<div style={{ fontSize: 12, color: "#6b7280" }}>总计</div>
									<div style={{ fontSize: 22, fontWeight: 600 }}>{esStats.total.toLocaleString()}</div>
								</div>
							</div>
							<PieChart slices={statusSlices} />
						</div>

						<div className="card grow">
							<h3 style={{ marginTop: 0 }}>今日模型调用分布</h3>
							{modelSlices.length === 0
								? <div className="muted">暂无数据</div>
								: <PieChart slices={modelSlices} />
							}
						</div>
					</div>
				</>
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

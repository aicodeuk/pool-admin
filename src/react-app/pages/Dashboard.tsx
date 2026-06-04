import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { getModelPricing, calcCost, fmtTokens } from "../lib/pricing";
import { MODEL_COLORS, statusColor, buildSlices, PieChart } from "../components/PieChart";

interface Stats {
	totals: { provider: string; status: string; n: number }[];
	proxy_count: number;
	group_count: number;
	mapping_count: number;
	expiring_soon: { id: number; provider: string; email: string | null; expire_date: string | null }[];
	token_expiring: { id: number; provider: string; email: string | null; access_token_expires_at: string | null }[];
	high_usage: { id: number; email: string | null; usage_5h_pct: number | null; usage_7d_pct: number | null }[];
}

interface ModelBucket {
	key: string;
	doc_count: number;
	input_tokens: { value: number };
	output_tokens: { value: number };
	cache_creation_tokens: { value: number };
	cache_read_tokens: { value: number };
}

interface IndexStats {
	status_buckets: { key: number; doc_count: number }[];
	model_buckets: ModelBucket[];
	total: number;
}

interface EsStats {
	claude?: IndexStats | { error: string };
	gpt?: IndexStats | { error: string };
	unconfigured?: boolean;
}

function isIndexStats(s: IndexStats | { error: string } | undefined): s is IndexStats {
	return !!s && "total" in s;
}

function EsProviderSection({ label, stats }: { label: string; stats: IndexStats }) {
	const today = new Date().toISOString().slice(0, 10);
	const successCount = stats.status_buckets.find((b) => b.key === 200)?.doc_count ?? 0;
	const errorCount = stats.total - successCount;

	const statusSlices = buildSlices(stats.status_buckets, stats.total, (k) => statusColor(k as number));
	const modelTotal = stats.model_buckets.reduce((a, b) => a + b.doc_count, 0);
	const modelSlices = buildSlices(stats.model_buckets, modelTotal, (_, i) => MODEL_COLORS[i % MODEL_COLORS.length]);

	const costRows = stats.model_buckets.map((b, i) => {
		const pricing = getModelPricing(b.key);
		const cost = pricing ? calcCost({
			input_tokens: b.input_tokens.value,
			output_tokens: b.output_tokens.value,
			cache_creation_tokens: b.cache_creation_tokens.value,
			cache_read_tokens: b.cache_read_tokens.value,
		}, pricing) : null;
		return { bucket: b, pricing, cost, color: MODEL_COLORS[i % MODEL_COLORS.length] };
	});
	const totalCost = costRows.reduce((a, r) => a + (r.cost ?? 0), 0);
	const hasTokenData = stats.model_buckets.some((b) => b.input_tokens.value > 0 || b.output_tokens.value > 0 || b.cache_creation_tokens.value > 0);

	return (
		<>
			<h2 style={{ marginTop: 24 }}>{label} 统计</h2>
			<div className="row" style={{ alignItems: "stretch", marginTop: 16 }}>
				<div className="card grow">
					<h3 style={{ marginTop: 0 }}>今日状态码分布（{today}）</h3>
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
							<div style={{ fontSize: 22, fontWeight: 600 }}>{stats.total.toLocaleString()}</div>
						</div>
					</div>
					<PieChart slices={statusSlices} />
				</div>

				<div className="card grow">
					<h3 style={{ marginTop: 0 }}>今日模型调用分布</h3>
					{modelSlices.length === 0
						? <div className="muted">暂无数据</div>
						: <PieChart slices={modelSlices} />}
				</div>
			</div>

			<div className="card" style={{ marginTop: 0 }}>
				<h3 style={{ marginTop: 0 }}>
					今日模型费用估算
					{hasTokenData && (
						<span style={{ marginLeft: 12, fontSize: 14, fontWeight: 400, color: "#6b7280" }}>
							合计 <span style={{ color: "#111", fontWeight: 600 }}>${totalCost.toFixed(4)}</span>
						</span>
					)}
				</h3>
				<div style={{ overflowX: "auto" }}>
					<table>
						<thead>
							<tr>
								<th>模型</th>
								<th style={{ textAlign: "right" }}>请求数</th>
								<th style={{ textAlign: "right" }}>Input</th>
								<th style={{ textAlign: "right" }}>Cache Write</th>
								<th style={{ textAlign: "right" }}>Cache Read</th>
								<th style={{ textAlign: "right" }}>Output</th>
								<th style={{ textAlign: "right" }}>单价 in/cw/cr/out</th>
								<th style={{ textAlign: "right" }}>费用 ($)</th>
							</tr>
						</thead>
						<tbody>
							{costRows.map((r, i) => (
								<tr key={i}>
									<td>
										<span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6 }} />
										<span className="mono" style={{ fontSize: 12 }}>{r.bucket.key}</span>
									</td>
									<td style={{ textAlign: "right" }}>{r.bucket.doc_count.toLocaleString()}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(r.bucket.input_tokens.value)}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(r.bucket.cache_creation_tokens.value)}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(r.bucket.cache_read_tokens.value)}</td>
									<td style={{ textAlign: "right" }} className="mono">{fmtTokens(r.bucket.output_tokens.value)}</td>
									<td style={{ textAlign: "right", color: "#6b7280", fontSize: 11 }}>
										{r.pricing
											? `$${r.pricing.input}/$${r.pricing.cacheWrite}/$${r.pricing.cacheHit}/$${r.pricing.output}`
											: <span className="muted">未知</span>}
									</td>
									<td style={{ textAlign: "right", fontWeight: 600 }}>
										{r.cost != null ? `$${r.cost.toFixed(4)}` : <span className="muted">—</span>}
									</td>
								</tr>
							))}
						</tbody>
						{costRows.length > 1 && (
							<tfoot>
								<tr style={{ borderTop: "1px solid #e2e8f0" }}>
									<td colSpan={6} style={{ textAlign: "right", color: "#6b7280", paddingTop: 8 }}>总计</td>
									<td style={{ textAlign: "right", fontWeight: 700, paddingTop: 8 }}>${totalCost.toFixed(4)}</td>
								</tr>
							</tfoot>
						)}
					</table>
				</div>
			</div>
		</>
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
	const activeOf = (provider: string) => byProvider(provider).find((t) => t.status === "active")?.n ?? 0;

	const showEs = esStats && !esStats.unconfigured;
	const claudeStats = isIndexStats(esStats?.claude) ? esStats.claude : null;
	const gptStats = isIndexStats(esStats?.gpt) ? esStats.gpt : null;

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
				<div className="stat"><div className="label">代理</div><div className="value">{stats.proxy_count}</div></div>
				<div className="stat"><div className="label">分组</div><div className="value">{stats.group_count}</div></div>
				<div className="stat"><div className="label">Kid 映射</div><div className="value">{stats.mapping_count}</div></div>
			</div>

			{showEs && (
				<>
					{claudeStats && <EsProviderSection label="Claude" stats={claudeStats} />}
					{gptStats && <EsProviderSection label="GPT" stats={gptStats} />}
				</>
			)}

			<div className="row" style={{ alignItems: "stretch", marginTop: 16 }}>
				<div className="card grow">
					<h3 style={{ marginTop: 0 }}>账号即将到期（7 天内）</h3>
					{stats.expiring_soon.length === 0 ? <div className="muted">暂无</div> : (
						<table>
							<thead><tr><th>ID</th><th>渠道</th><th>邮箱</th><th>到期日</th></tr></thead>
							<tbody>{stats.expiring_soon.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.provider}</td><td>{r.email}</td><td>{r.expire_date}</td></tr>)}</tbody>
						</table>
					)}
				</div>
				<div className="card grow">
					<h3 style={{ marginTop: 0 }}>Token 即将过期（30 分钟内）</h3>
					{stats.token_expiring.length === 0 ? <div className="muted">暂无</div> : (
						<table>
							<thead><tr><th>ID</th><th>渠道</th><th>邮箱</th><th>过期时间</th></tr></thead>
							<tbody>{stats.token_expiring.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.provider}</td><td>{r.email}</td><td className="mono">{r.access_token_expires_at}</td></tr>)}</tbody>
						</table>
					)}
				</div>
			</div>

			<div className="card">
				<h3 style={{ marginTop: 0 }}>用量超 80%（Claude）</h3>
				{stats.high_usage.length === 0 ? <div className="muted">暂无</div> : (
					<table>
						<thead><tr><th>ID</th><th>邮箱</th><th>5h</th><th>7d</th></tr></thead>
						<tbody>{stats.high_usage.map((r) => (
							<tr key={r.id}><td>{r.id}</td><td>{r.email}</td><td>{r.usage_5h_pct?.toFixed(1) ?? "-"}%</td><td>{r.usage_7d_pct?.toFixed(1) ?? "-"}%</td></tr>
						))}</tbody>
					</table>
				)}
			</div>
		</>
	);
}

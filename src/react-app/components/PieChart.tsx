// Distinct color palette for model pie chart
export const MODEL_COLORS = [
	"#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#ec4899",
	"#14b8a6", "#f97316", "#8b5cf6", "#06b6d4", "#84cc16",
	"#ef4444", "#a78bfa", "#fb923c", "#34d399", "#60a5fa",
];

export function statusColor(code: number): string {
	if (code === 200) return "#16a34a";
	if (code >= 200 && code < 300) return "#4ade80";
	if (code >= 400 && code < 500) return "#f59e0b";
	if (code >= 500) return "#dc2626";
	return "#6b7280";
}

export interface Slice { key: string | number; count: number; frac: number; color: string; path: string }

export function buildSlices(
	buckets: { key: string | number; doc_count: number }[],
	total: number,
	colorFn: (key: string | number, i: number) => string,
): Slice[] {
	const cx = 90, cy = 90, r = 76;
	let angle = -Math.PI / 2;
	return buckets.map((b, i) => {
		const frac = total > 0 ? b.doc_count / total : 0;
		const start = angle;
		const end = angle + frac * 2 * Math.PI;
		angle = end;
		const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
		const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
		return { key: b.key, count: b.doc_count, frac, color: colorFn(b.key, i), path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2},${y2} Z` };
	});
}

export function PieChart({ slices }: { slices: Slice[] }) {
	return (
		<div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
			<svg viewBox="0 0 180 180" width={160} height={160} style={{ flexShrink: 0 }}>
				{slices.map((s, i) => (
					<path key={i} d={s.path} fill={s.color}>
						<title>{s.key}: {s.count.toLocaleString()} ({(s.frac * 100).toFixed(1)}%)</title>
					</path>
				))}
			</svg>
			<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
				{slices.map((s, i) => (
					<div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
						<span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
						<span className="mono" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.key}</span>
						<span style={{ color: "#6b7280", flexShrink: 0 }}>{s.count.toLocaleString()}</span>
						<span style={{ color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>({(s.frac * 100).toFixed(1)}%)</span>
					</div>
				))}
			</div>
		</div>
	);
}

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface Row {
	id: number;
	kid: number;
	provider: string;
	account_id: number;
	email: string | null;
	group_name: string | null;
	tier: string | null;
	updated_at: string;
}

interface Stats {
	live: number;
	hour: number;
	today: number;
}

function isLive(updatedAt: string): boolean {
	const t = new Date(updatedAt.replace(" ", "T") + "Z").getTime();
	return Date.now() - t < 10 * 60 * 1000;
}

export function KidMappings() {
	const [items, setItems] = useState<Row[]>([]);
	const [stats, setStats] = useState<Stats>({ live: 0, hour: 0, today: 0 });
	const [filters, setFilters] = useState({ provider: "", kid: "" });

	const reload = useCallback(async () => {
		const params = new URLSearchParams();
		if (filters.provider) params.set("provider", filters.provider);
		if (filters.kid) params.set("kid", filters.kid);
		const r = await api.get<{ items: Row[]; stats: Stats }>(`/api/admin/kid-mappings?${params}`);
		setItems(r.items);
		setStats(r.stats);
	}, [filters]);

	useEffect(() => { reload(); }, [reload]);

	async function remove(id: number) {
		if (!confirm(`删除 mapping #${id}？账号 used_count -1`)) return;
		await api.delete(`/api/admin/kid-mappings/${id}`);
		reload();
	}

	return (
		<>
			<h2>Kid 账号映射</h2>

			<div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
				<div className="card" style={{ flex: 1, textAlign: "center", padding: "12px 16px" }}>
					<div style={{ fontSize: 26, fontWeight: 700, color: "#16a34a" }}>{stats.live}</div>
					<div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>在线（10分钟内）</div>
				</div>
				<div className="card" style={{ flex: 1, textAlign: "center", padding: "12px 16px" }}>
					<div style={{ fontSize: 26, fontWeight: 700 }}>{stats.hour}</div>
					<div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>1小时内在线</div>
				</div>
				<div className="card" style={{ flex: 1, textAlign: "center", padding: "12px 16px" }}>
					<div style={{ fontSize: 26, fontWeight: 700 }}>{stats.today}</div>
					<div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>今日在线（UTC）</div>
				</div>
			</div>

			<div className="toolbar">
				<select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}>
					<option value="">全部 provider</option>
					<option value="claude">claude</option>
					<option value="gpt">gpt</option>
					<option value="gemini">gemini</option>
				</select>
				<input placeholder="kid" value={filters.kid} onChange={(e) => setFilters({ ...filters, kid: e.target.value })} />
				<button onClick={reload}>刷新</button>
			</div>

			<div className="card" style={{ padding: 0 }}>
				<table>
					<thead>
						<tr><th>id</th><th>kid</th><th>provider</th><th>account</th><th>邮箱</th><th>组</th><th>tier</th><th>更新时间</th><th>状态</th><th>操作</th></tr>
					</thead>
					<tbody>
						{items.map((r) => (
							<tr key={r.id}>
								<td>{r.id}</td>
								<td>{r.kid}</td>
								<td>{r.provider}</td>
								<td>{r.account_id}</td>
								<td>{r.email ?? "-"}</td>
								<td>{r.group_name ?? "-"}</td>
								<td>{r.tier ?? "-"}</td>
								<td className="mono">{r.updated_at}</td>
								<td>
									{isLive(r.updated_at)
										? <span className="badge active">live</span>
										: <span className="muted" style={{ fontSize: 11 }}>offline</span>}
								</td>
								<td><button className="ghost danger" onClick={() => remove(r.id)}>删</button></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

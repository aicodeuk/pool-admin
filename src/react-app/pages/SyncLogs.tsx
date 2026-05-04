import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface SyncLog {
	id: number;
	provider: string;
	kid: number | null;
	force_replace: number;
	is_max: number | null;
	aid: number | null;
	assigned_account_id: number | null;
	http_status: number;
	details: string | null;
	created_at: string;
}

export function SyncLogs() {
	const [items, setItems] = useState<SyncLog[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [filters, setFilters] = useState({ provider: "claude", force_replace: "", kid: "", aid: "", account_id: "" });

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (filters.provider) params.set("provider", filters.provider);
			if (filters.force_replace !== "") params.set("force_replace", filters.force_replace);
			if (filters.kid) params.set("kid", filters.kid);
			if (filters.aid) params.set("aid", filters.aid);
			if (filters.account_id) params.set("account_id", filters.account_id);
			const r = await api.get<{ items: SyncLog[]; total: number }>(`/api/admin/sync-logs?${params}`);
			setItems(r.items);
			setTotal(r.total);
		} finally {
			setLoading(false);
		}
	}, [filters]);

	useEffect(() => { reload(); }, [reload]);

	return (
		<>
			<h2>请求日志（近24小时）{total > 0 && ` — ${total} 条`}</h2>
			<div className="toolbar">
				<select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}>
					<option value="claude">claude</option>
					<option value="gpt">gpt</option>
					<option value="gemini">gemini</option>
					<option value="">全部</option>
				</select>
				<select value={filters.force_replace} onChange={(e) => setFilters({ ...filters, force_replace: e.target.value })}>
					<option value="">全部</option>
					<option value="1">force_replace=true</option>
					<option value="0">force_replace=false</option>
				</select>
				<input
					placeholder="kid"
					style={{ width: 80 }}
					value={filters.kid}
					onChange={(e) => setFilters({ ...filters, kid: e.target.value })}
				/>
				<input
					placeholder="aid (问题账号)"
					style={{ width: 120 }}
					value={filters.aid}
					onChange={(e) => setFilters({ ...filters, aid: e.target.value })}
				/>
				<input
					placeholder="分配账号 ID"
					style={{ width: 100 }}
					value={filters.account_id}
					onChange={(e) => setFilters({ ...filters, account_id: e.target.value })}
				/>
				<button onClick={reload} disabled={loading}>刷新</button>
			</div>

			<div className="card" style={{ padding: 0, overflow: "auto" }}>
				<table>
					<thead>
						<tr>
							<th>ID</th>
							<th>时间</th>
							<th>provider</th>
							<th>kid</th>
							<th>force?</th>
							<th>is_max</th>
							<th>aid</th>
							<th>分配账号</th>
							<th>状态</th>
							<th>客户端详情</th>
						</tr>
					</thead>
					<tbody>
						{items.map((r) => (
							<tr key={r.id}>
								<td>{r.id}</td>
								<td className="mono" style={{ whiteSpace: "nowrap" }}>{r.created_at}</td>
								<td>{r.provider}</td>
								<td>{r.kid ?? "-"}</td>
								<td>{r.force_replace ? <span className="badge problem">是</span> : <span className="muted">否</span>}</td>
								<td>{r.is_max === 1 ? "max" : r.is_max === 0 ? "0" : "-"}</td>
								<td>{r.aid ?? "-"}</td>
								<td>{r.assigned_account_id ?? <span className="muted">-</span>}</td>
								<td>
									<span className={r.http_status === 200 ? "badge active" : "badge problem"}>
										{r.http_status}
									</span>
								</td>
								<td className="truncate" style={{ maxWidth: 320, fontSize: 12 }} title={r.details ?? ""}>
									{r.details ?? <span className="muted">-</span>}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

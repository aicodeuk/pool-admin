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

export function KidMappings() {
	const [items, setItems] = useState<Row[]>([]);
	const [filters, setFilters] = useState({ provider: "", kid: "" });

	const reload = useCallback(async () => {
		const params = new URLSearchParams();
		if (filters.provider) params.set("provider", filters.provider);
		if (filters.kid) params.set("kid", filters.kid);
		const r = await api.get<{ items: Row[] }>(`/api/admin/kid-mappings?${params}`);
		setItems(r.items);
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
					<thead><tr><th>id</th><th>kid</th><th>provider</th><th>account</th><th>邮箱</th><th>组</th><th>tier</th><th>更新时间</th><th>操作</th></tr></thead>
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
								<td><button className="ghost danger" onClick={() => remove(r.id)}>删</button></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

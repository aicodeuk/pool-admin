import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Row {
	id: number;
	actor: string | null;
	action: string;
	target_type: string | null;
	target_id: number | null;
	diff_json: string | null;
	created_at: string;
}

export function Audit() {
	const [items, setItems] = useState<Row[]>([]);

	async function reload() {
		const r = await api.get<{ items: Row[] }>("/api/admin/audit");
		setItems(r.items);
	}
	useEffect(() => { reload(); }, []);

	return (
		<>
			<h2>审计日志</h2>
			<div className="toolbar"><button onClick={reload}>刷新</button></div>
			<div className="card" style={{ padding: 0 }}>
				<table>
					<thead><tr><th>id</th><th>时间</th><th>actor</th><th>action</th><th>目标</th><th>diff</th></tr></thead>
					<tbody>
						{items.map((r) => (
							<tr key={r.id}>
								<td>{r.id}</td>
								<td className="mono">{r.created_at}</td>
								<td>{r.actor ?? "-"}</td>
								<td className="mono">{r.action}</td>
								<td>{r.target_type ? `${r.target_type}#${r.target_id ?? "-"}` : "-"}</td>
								<td className="mono truncate" style={{ maxWidth: 400 }}>{r.diff_json ?? "-"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

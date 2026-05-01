import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Row { kid: number; group_name: string; note: string | null; updated_at: string; }

function kindOf(name: string): string {
	if (name.startsWith("channel_")) return "channel";
	if (name.startsWith("org_")) return "org";
	return "normal";
}

export function KidGroups() {
	const [items, setItems] = useState<Row[]>([]);
	const [adding, setAdding] = useState(false);
	const [form, setForm] = useState({ kid: "", group_name: "", note: "" });

	async function reload() {
		const a = await api.get<{ items: Row[] }>("/api/admin/kid-groups");
		setItems(a.items);
	}
	useEffect(() => { reload(); }, []);

	async function save() {
		const kid = Number(form.kid);
		if (!Number.isFinite(kid) || !form.group_name.trim()) return;
		await api.put(`/api/admin/kid-groups/${kid}`, { group_name: form.group_name.trim(), note: form.note.trim() || undefined });
		setForm({ kid: "", group_name: "", note: "" });
		setAdding(false);
		reload();
	}

	async function remove(kid: number) {
		if (!confirm(`解绑 kid=${kid}？`)) return;
		await api.delete(`/api/admin/kid-groups/${kid}`);
		reload();
	}

	return (
		<>
			<h2>Kid 分组绑定</h2>
			<div className="toolbar">
				<button className="primary" onClick={() => setAdding(true)}>+ 绑定</button>
				<span className="muted" style={{ fontSize: 12 }}>
					组名为自由文本：以 <code>channel_</code> 开头严格绑定，<code>org_</code> 开头可 fallback，其他为普通组
				</span>
			</div>
			<div className="card" style={{ padding: 0 }}>
				<table>
					<thead><tr><th>kid</th><th>组</th><th>类型</th><th>备注</th><th>更新时间</th><th>操作</th></tr></thead>
					<tbody>
						{items.map((r) => (
							<tr key={r.kid}>
								<td>{r.kid}</td>
								<td className="mono">{r.group_name}</td>
								<td><span className={`badge ${kindOf(r.group_name)}`}>{kindOf(r.group_name)}</span></td>
								<td className="muted">{r.note ?? "—"}</td>
								<td className="mono">{r.updated_at}</td>
								<td><button className="ghost danger" onClick={() => remove(r.kid)}>解绑</button></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{adding && (
				<div className="modal-back" onClick={() => setAdding(false)}>
					<div className="modal" onClick={(e) => e.stopPropagation()}>
						<h3>绑定 / 修改</h3>
						<div className="field">
							<label>kid (API key id)</label>
							<input value={form.kid} onChange={(e) => setForm({ ...form, kid: e.target.value })} autoFocus />
						</div>
						<div className="field">
							<label>组名（任意字符串）</label>
							<input
								value={form.group_name}
								onChange={(e) => setForm({ ...form, group_name: e.target.value })}
								placeholder="channel_max / org_xxx / 自定义"
							/>
							{form.group_name && (
								<span className="muted" style={{ fontSize: 11 }}>
									类型：{kindOf(form.group_name)}
								</span>
							)}
						</div>
						<div className="field">
							<label>备注（可选）</label>
							<input
								value={form.note}
								onChange={(e) => setForm({ ...form, note: e.target.value })}
								placeholder="别名或用途说明"
							/>
						</div>
						<div className="row" style={{ justifyContent: "flex-end" }}>
							<button onClick={() => setAdding(false)}>取消</button>
							<button className="primary" onClick={save}>保存</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Row { kid: number; group_name: string; note: string | null; updated_at: string; }
interface RangeRow { id: number; kid_from: number; kid_to: number; group_name: string; note: string | null; priority: number; created_at: string; }

function kindOf(name: string): string {
	if (name.startsWith("channel_")) return "channel";
	if (name.startsWith("org_")) return "org";
	return "normal";
}

const EMPTY_RANGE = { kid_from: "", kid_to: "", group_name: "", note: "", priority: "0" };

export function KidGroups() {
	const [items, setItems] = useState<Row[]>([]);
	const [adding, setAdding] = useState(false);
	const [form, setForm] = useState({ kid: "", group_name: "", note: "" });

	const [ranges, setRanges] = useState<RangeRow[]>([]);
	const [addingRange, setAddingRange] = useState(false);
	const [editingRange, setEditingRange] = useState<RangeRow | null>(null);
	const [rangeForm, setRangeForm] = useState(EMPTY_RANGE);

	async function reload() {
		const a = await api.get<{ items: Row[] }>("/api/admin/kid-groups");
		setItems(a.items);
	}
	async function reloadRanges() {
		const a = await api.get<{ items: RangeRow[] }>("/api/admin/kid-group-ranges");
		setRanges(a.items);
	}
	useEffect(() => { reload(); reloadRanges(); }, []);

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

	async function saveRange() {
		const from = Number(rangeForm.kid_from);
		const to   = Number(rangeForm.kid_to);
		if (!Number.isFinite(from) || !Number.isFinite(to) || !rangeForm.group_name.trim()) return;
		if (to < from) { alert("kid 止 必须 >= kid 起"); return; }
		const body = {
			kid_from: from, kid_to: to,
			group_name: rangeForm.group_name.trim(),
			note: rangeForm.note.trim() || undefined,
			priority: Number(rangeForm.priority) || 0,
		};
		if (editingRange) {
			await api.put(`/api/admin/kid-group-ranges/${editingRange.id}`, body);
		} else {
			await api.post("/api/admin/kid-group-ranges", body);
		}
		setRangeForm(EMPTY_RANGE);
		setAddingRange(false);
		setEditingRange(null);
		reloadRanges();
	}

	function startEditRange(r: RangeRow) {
		setRangeForm({ kid_from: String(r.kid_from), kid_to: String(r.kid_to), group_name: r.group_name, note: r.note ?? "", priority: String(r.priority) });
		setEditingRange(r);
		setAddingRange(true);
	}

	async function removeRange(id: number) {
		if (!confirm(`删除范围规则 #${id}？`)) return;
		await api.delete(`/api/admin/kid-group-ranges/${id}`);
		reloadRanges();
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

			{/* ── Range rules ── */}
			<h2 style={{ marginTop: 32 }}>范围分组规则</h2>
			<div className="toolbar">
				<button className="primary" onClick={() => { setRangeForm(EMPTY_RANGE); setEditingRange(null); setAddingRange(true); }}>+ 新增范围</button>
				<span className="muted" style={{ fontSize: 12 }}>
					优先级：精确绑定 &gt; 范围规则（priority 大的先匹配）&gt; 兜底 null 组
				</span>
			</div>
			<div className="card" style={{ padding: 0 }}>
				<table>
					<thead>
						<tr>
							<th>kid 起</th><th>kid 止</th><th>组名</th><th>类型</th>
							<th>priority</th><th>备注</th><th>创建时间</th><th>操作</th>
						</tr>
					</thead>
					<tbody>
						{ranges.length === 0 && (
							<tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 16 }}>暂无范围规则</td></tr>
						)}
						{ranges.map((r) => (
							<tr key={r.id}>
								<td className="mono">{r.kid_from}</td>
								<td className="mono">{r.kid_to}</td>
								<td className="mono">{r.group_name}</td>
								<td><span className={`badge ${kindOf(r.group_name)}`}>{kindOf(r.group_name)}</span></td>
								<td>{r.priority}</td>
								<td className="muted">{r.note ?? "—"}</td>
								<td className="mono">{r.created_at.slice(0, 10)}</td>
								<td>
									<div className="row" style={{ gap: 4 }}>
										<button className="ghost" onClick={() => startEditRange(r)}>编辑</button>
										<button className="ghost danger" onClick={() => removeRange(r.id)}>删除</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{addingRange && (
				<div className="modal-back" onClick={() => { setAddingRange(false); setEditingRange(null); }}>
					<div className="modal" onClick={(e) => e.stopPropagation()}>
						<h3>{editingRange ? "编辑范围规则" : "新增范围规则"}</h3>
						<div className="row" style={{ gap: 8 }}>
							<div className="field" style={{ flex: 1 }}>
								<label>kid 起（含）</label>
								<input type="number" min="0" value={rangeForm.kid_from} onChange={(e) => setRangeForm({ ...rangeForm, kid_from: e.target.value })} autoFocus />
							</div>
							<div className="field" style={{ flex: 1 }}>
								<label>kid 止（含）</label>
								<input type="number" min="0" value={rangeForm.kid_to} onChange={(e) => setRangeForm({ ...rangeForm, kid_to: e.target.value })} />
							</div>
						</div>
						<div className="field">
							<label>组名</label>
							<input
								value={rangeForm.group_name}
								onChange={(e) => setRangeForm({ ...rangeForm, group_name: e.target.value })}
								placeholder="shua-group / cmd-group / channel_vip"
							/>
							{rangeForm.group_name && (
								<span className="muted" style={{ fontSize: 11 }}>类型：{kindOf(rangeForm.group_name)}</span>
							)}
						</div>
						<div className="row" style={{ gap: 8 }}>
							<div className="field" style={{ flex: 1 }}>
								<label>优先级（大的先匹配）</label>
								<input type="number" value={rangeForm.priority} onChange={(e) => setRangeForm({ ...rangeForm, priority: e.target.value })} />
							</div>
							<div className="field" style={{ flex: 2 }}>
								<label>备注（可选）</label>
								<input value={rangeForm.note} onChange={(e) => setRangeForm({ ...rangeForm, note: e.target.value })} placeholder="说明用途" />
							</div>
						</div>
						<div className="row" style={{ justifyContent: "flex-end" }}>
							<button onClick={() => { setAddingRange(false); setEditingRange(null); }}>取消</button>
							<button className="primary" onClick={saveRange}>保存</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

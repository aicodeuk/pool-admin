import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface Account {
	id: number;
	provider: string;
	email: string | null;
	name: string | null;
	group_name: string | null;
	tier: string;
	status: string;
	multiplier: number;
	used_count: number;
	total_capacity: number;
	available_count: number;
	is_third_party: number;
	access_token_expires_at: string | null;
	expire_date: string | null;
	usage_5h_pct: number | null;
	usage_7d_pct: number | null;
	proxy_label: string | null;
}

export function Accounts() {
	const [items, setItems] = useState<Account[]>([]);
	const [total, setTotal] = useState(0);
	const [filters, setFilters] = useState({ provider: "claude", status: "", q: "" });
	const [loading, setLoading] = useState(false);
	const [editing, setEditing] = useState<Account | null>(null);
	const [testing, setTesting] = useState<number | null>(null);
	const [testResult, setTestResult] = useState<{ id: number; ok: boolean; reason: string | null } | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (filters.provider) params.set("provider", filters.provider);
			if (filters.status) params.set("status", filters.status);
			if (filters.q) params.set("q", filters.q);
			const r = await api.get<{ items: Account[]; total: number }>(`/api/admin/accounts?${params}`);
			setItems(r.items);
			setTotal(r.total);
		} finally {
			setLoading(false);
		}
	}, [filters]);

	useEffect(() => {
		reload();
	}, [reload]);

	async function patch(id: number, body: Partial<Account>) {
		await api.patch(`/api/admin/accounts/${id}`, body);
		reload();
	}

	async function remove(id: number) {
		if (!confirm(`删除账号 #${id}？`)) return;
		await api.delete(`/api/admin/accounts/${id}`);
		reload();
	}

	async function clearProblem(id: number) {
		await api.post(`/api/admin/accounts/${id}/clear-problem`);
		reload();
	}

	async function resetUsed(id: number) {
		if (!confirm(`重置 #${id} 的使用计数 + 删除 mapping？`)) return;
		await api.post(`/api/admin/accounts/${id}/reset-used`);
		reload();
	}

	async function testAccount(id: number) {
		setTesting(id);
		setTestResult(null);
		try {
			const r = await api.post<{ ok: boolean; status: string; status_reason: string | null }>(`/api/admin/accounts/${id}/test`);
			setTestResult({ id, ok: r.ok, reason: r.status_reason });
			reload();
		} catch (e) {
			setTestResult({ id, ok: false, reason: (e as Error).message });
		} finally {
			setTesting(null);
		}
	}

	return (
		<>
			<h2>账号管理 ({total})</h2>
			<div className="toolbar">
				<select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}>
					<option value="claude">claude</option>
					<option value="gpt">gpt</option>
					<option value="gemini">gemini</option>
					<option value="">全部</option>
				</select>
				<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
					<option value="">全部状态</option>
					<option value="active">active</option>
					<option value="paused">paused</option>
					<option value="problem">problem</option>
					<option value="exhausted">exhausted</option>
				</select>
				<input
					placeholder="邮箱 / 备注 / user_id"
					value={filters.q}
					onChange={(e) => setFilters({ ...filters, q: e.target.value })}
				/>
				<button onClick={reload} disabled={loading}>刷新</button>
			</div>

			{testResult && (
				<div style={{ padding: "8px 12px", marginBottom: 12, borderRadius: 6, border: "1px solid", fontSize: 13, background: testResult.ok ? "#ecfdf5" : "#fef2f2", borderColor: testResult.ok ? "#6ee7b7" : "#fca5a5" }}>
					{testResult.ok
						? `✓ #${testResult.id} 探活成功 → active`
						: `✗ #${testResult.id} 探活失败${testResult.reason ? `：${testResult.reason}` : ""}`}
					<button className="ghost" style={{ marginLeft: 8, padding: "2px 6px", fontSize: 11 }} onClick={() => setTestResult(null)}>✕</button>
				</div>
			)}

			<div className="card" style={{ padding: 0, overflow: "auto" }}>
				<table>
					<thead>
						<tr>
							<th>ID</th><th>邮箱 / 备注</th><th>组</th><th>tier</th><th>状态</th>
							<th>容量</th><th>×</th><th>到期</th><th>5h%</th><th>7d%</th><th>代理</th><th>操作</th>
						</tr>
					</thead>
					<tbody>
						{items.map((a) => (
							<tr key={a.id}>
								<td>{a.id}</td>
								<td>
									<div>{a.email}</div>
									{a.name && <div className="muted" style={{ fontSize: 11 }}>{a.name}</div>}
								</td>
								<td>{a.group_name ?? <span className="muted">-</span>}</td>
								<td>{a.tier}</td>
								<td><span className={`badge ${a.status}`}>{a.status}</span></td>
								<td>{a.used_count}/{a.total_capacity}</td>
								<td>{a.multiplier}</td>
								<td className="mono">{a.expire_date ?? "-"}</td>
								<td>{a.usage_5h_pct?.toFixed(0) ?? "-"}</td>
								<td>{a.usage_7d_pct?.toFixed(0) ?? "-"}</td>
								<td className="mono truncate">{a.proxy_label ?? "-"}</td>
								<td>
									<div className="row" style={{ gap: 4 }}>
										<button className="ghost" onClick={() => setEditing(a)}>编辑</button>
										<button className="ghost" onClick={() => testAccount(a.id)} disabled={testing === a.id} title="发送探活请求，成功→active，失败→problem">
											{testing === a.id ? "…" : "探活"}
										</button>
										{a.status === "problem" && <button className="ghost" onClick={() => clearProblem(a.id)}>恢复</button>}
										<button className="ghost" onClick={() => patch(a.id, { status: a.status === "paused" ? "active" : "paused" })}>{a.status === "paused" ? "启用" : "停用"}</button>
										<button className="ghost" onClick={() => resetUsed(a.id)}>重置</button>
										<button className="ghost danger" onClick={() => remove(a.id)}>删</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{editing && <EditModal account={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
		</>
	);
}

function EditModal({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
	const [form, setForm] = useState({
		name: account.name ?? "",
		group_name: account.group_name ?? "",
		tier: account.tier,
		multiplier: account.multiplier,
		total_capacity: account.total_capacity,
		expire_date: account.expire_date ?? "",
	});

	async function save() {
		await api.patch(`/api/admin/accounts/${account.id}`, {
			name: form.name || null,
			group_name: form.group_name || null,
			tier: form.tier,
			multiplier: Number(form.multiplier),
			total_capacity: Number(form.total_capacity),
			expire_date: form.expire_date || null,
		});
		onSaved();
	}

	return (
		<div className="modal-back" onClick={onClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<h3>编辑 #{account.id}</h3>
				<div className="field"><label>备注</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
				<div className="field"><label>组名</label><input value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })} /></div>
				<div className="field"><label>tier</label>
					<select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
						<option value="free">free</option><option value="pro">pro</option><option value="max">max</option>
					</select>
				</div>
				<div className="field"><label>积分倍率</label><input type="number" step="0.1" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: Number(e.target.value) })} /></div>
				<div className="field"><label>总容量</label><input type="number" value={form.total_capacity} onChange={(e) => setForm({ ...form, total_capacity: Number(e.target.value) })} /></div>
				<div className="field"><label>到期日 (YYYY-MM-DD)</label><input value={form.expire_date} onChange={(e) => setForm({ ...form, expire_date: e.target.value })} /></div>
				<div className="row" style={{ justifyContent: "flex-end" }}>
					<button onClick={onClose}>取消</button>
					<button className="primary" onClick={save}>保存</button>
				</div>
			</div>
		</div>
	);
}

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
	priority: number;
	used_count: number;
	total_capacity: number;
	available_count: number;
	is_third_party: number;
	access_token_expires_at: string | null;
	expire_date: string | null;
	usage_5h_pct: number | null;
	usage_7d_pct: number | null;
	proxy_id: number | null;
	proxy_label: string | null;
	kid_count: number;
	created_at: string;
}

export function Accounts() {
	const [items, setItems] = useState<Account[]>([]);
	const [total, setTotal] = useState(0);
	const [filters, setFilters] = useState({ provider: "claude", status: "", q: "" });
	const [loading, setLoading] = useState(false);
	const [editing, setEditing] = useState<Account | null>(null);
	const [testModal, setTestModal] = useState<{ account: Account; loading: boolean; result: TestResult | null; error: string | null } | null>(null);
	const [inlineEdit, setInlineEdit] = useState<{ id: number; field: string; value: string } | null>(null);

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

	function startInline(id: number, field: string, value: string) {
		setInlineEdit({ id, field, value });
	}

	async function commitInline(override?: { id: number; field: string; value: string }) {
		const edit = override ?? inlineEdit;
		if (!edit) return;
		setInlineEdit(null);
		const numFields = ["multiplier", "priority", "total_capacity"];
		const coerced = numFields.includes(edit.field) ? Number(edit.value) : (edit.value || null);
		await api.patch(`/api/admin/accounts/${edit.id}`, { [edit.field]: coerced });
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

	async function testAccount(account: Account) {
		setTestModal({ account, loading: true, result: null, error: null });
		try {
			const r = await api.post<TestResult>(`/api/admin/accounts/${account.id}/test`);
			setTestModal((prev) => prev && { ...prev, loading: false, result: r });
			reload();
		} catch (e) {
			setTestModal((prev) => prev && { ...prev, loading: false, error: (e as Error).message });
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


			<div className="card" style={{ padding: 0, overflow: "auto" }}>
				<table>
					<thead>
						<tr>
							<th>ID</th><th>邮箱 / 备注</th><th>组</th><th>tier</th><th>状态</th>
							<th>容量</th><th>绑定keys</th><th>×</th><th>优先级</th><th>到期</th><th>5h%</th><th>7d%</th><th>代理</th><th>添加时间</th><th>操作</th>
						</tr>
					</thead>
					<tbody>
						{items.map((a) => (
							<tr key={a.id}>
								<td>{a.id}</td>
								<td>
									<div>{a.email}</div>
									{inlineEdit?.id === a.id && inlineEdit.field === "name" ? (
										<input
											autoFocus
											className="inline-input"
											value={inlineEdit.value}
											onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
											onBlur={() => commitInline()}
											onKeyDown={(e) => { if (e.key === "Enter") commitInline(); if (e.key === "Escape") setInlineEdit(null); }}
										/>
									) : (
										<div
											className="muted inline-cell"
											style={{ fontSize: 11 }}
											onClick={() => startInline(a.id, "name", a.name ?? "")}
										>
											{a.name || <span style={{ opacity: 0.35 }}>+ 备注</span>}
										</div>
									)}
								</td>
								<td>
									{inlineEdit?.id === a.id && inlineEdit.field === "group_name" ? (
										<input
											autoFocus
											className="inline-input"
											value={inlineEdit.value}
											onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
											onBlur={() => commitInline()}
											onKeyDown={(e) => { if (e.key === "Enter") commitInline(); if (e.key === "Escape") setInlineEdit(null); }}
										/>
									) : (
										<span className="inline-cell" onClick={() => startInline(a.id, "group_name", a.group_name ?? "")}>
											{a.group_name ?? <span className="muted">-</span>}
										</span>
									)}
								</td>
								<td>
									{inlineEdit?.id === a.id && inlineEdit.field === "tier" ? (
										<select
											autoFocus
											className="inline-input"
											value={inlineEdit.value}
											onChange={(e) => commitInline({ id: a.id, field: "tier", value: e.target.value })}
											onBlur={() => setInlineEdit(null)}
										>
											<option value="free">free</option>
											<option value="pro">pro</option>
											<option value="max">max</option>
										</select>
									) : (
										<span className="inline-cell" onClick={() => startInline(a.id, "tier", a.tier)}>{a.tier}</span>
									)}
								</td>
								<td><span className={`badge ${a.status}`}>{a.status}</span></td>
								<td>
									{a.used_count}/
									{inlineEdit?.id === a.id && inlineEdit.field === "total_capacity" ? (
										<input
											autoFocus
											type="number"
											min="0"
											className="inline-input"
											style={{ width: 56 }}
											value={inlineEdit.value}
											onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
											onBlur={() => commitInline()}
											onKeyDown={(e) => { if (e.key === "Enter") commitInline(); if (e.key === "Escape") setInlineEdit(null); }}
										/>
									) : (
										<span className="inline-cell" onClick={() => startInline(a.id, "total_capacity", String(a.total_capacity))}>{a.total_capacity}</span>
									)}
								</td>
								<td>{a.kid_count}</td>
								<td>
									{inlineEdit?.id === a.id && inlineEdit.field === "multiplier" ? (
										<input
											autoFocus
											type="number"
											step="0.1"
											className="inline-input"
											style={{ width: 64 }}
											value={inlineEdit.value}
											onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
											onBlur={() => commitInline()}
											onKeyDown={(e) => { if (e.key === "Enter") commitInline(); if (e.key === "Escape") setInlineEdit(null); }}
										/>
									) : (
										<span className="inline-cell" onClick={() => startInline(a.id, "multiplier", String(a.multiplier))}>{a.multiplier}</span>
									)}
								</td>
								<td>
									{inlineEdit?.id === a.id && inlineEdit.field === "priority" ? (
										<input
											autoFocus
											type="number"
											min="0"
											className="inline-input"
											style={{ width: 48 }}
											value={inlineEdit.value}
											onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
											onBlur={() => commitInline()}
											onKeyDown={(e) => { if (e.key === "Enter") commitInline(); if (e.key === "Escape") setInlineEdit(null); }}
										/>
									) : (
										<span className="inline-cell" onClick={() => startInline(a.id, "priority", String(a.priority ?? 0))}>{a.priority ?? 0}</span>
									)}
								</td>
								<td className="mono">{a.expire_date ?? "-"}</td>
								<td>{a.usage_5h_pct?.toFixed(0) ?? "-"}</td>
								<td>{a.usage_7d_pct?.toFixed(0) ?? "-"}</td>
								<td className="mono truncate">{a.proxy_label ?? "-"}</td>
								<td className="mono">{a.created_at.slice(0, 10)}</td>
								<td>
									<div className="row" style={{ gap: 4 }}>
										<button className="ghost" onClick={() => setEditing(a)}>编辑</button>
										<button className="ghost" onClick={() => testAccount(a)} title="发送探活请求，成功→active，失败→problem">探活</button>
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
			{testModal && <TestModal state={testModal} onClose={() => setTestModal(null)} />}
		</>
	);
}

interface TestResult {
	ok: boolean;
	status: string;
	status_reason: string | null;
	http_status: number | null;
	request_url: string;
	proxy: string | null;
	request_payload: unknown;
	response_body: string | null;
}

function TestModal({ state, onClose }: { state: { account: Account; loading: boolean; result: TestResult | null; error: string | null }; onClose: () => void }) {
	const { account, loading, result, error } = state;

	function formatBody(raw: string | null): string {
		if (!raw) return "";
		try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
	}

	const statusColor = result ? (result.ok ? "#16a34a" : "#dc2626") : "#6b7280";

	return (
		<div className="modal-back" onClick={onClose}>
			<div className="modal" style={{ maxWidth: 620, width: "100%" }} onClick={(e) => e.stopPropagation()}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
					<h3 style={{ margin: 0 }}>探活 #{account.id}{account.email ? ` — ${account.email}` : ""}</h3>
					{!loading && result && (
						<span style={{ fontWeight: 600, color: statusColor, fontSize: 13 }}>
							{result.ok ? "✓ 成功" : "✗ 失败"}{result.http_status ? ` HTTP ${result.http_status}` : ""}
						</span>
					)}
				</div>

				{loading && <div style={{ textAlign: "center", padding: "32px 0", color: "#6b7280" }}>请求中…</div>}

				{error && <div style={{ padding: "10px 12px", borderRadius: 6, background: "#fef2f2", color: "#dc2626", fontSize: 13 }}>{error}</div>}

				{result && (<>
					<div style={{ marginBottom: 12 }}>
						<div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>请求</div>
						<div style={{ fontSize: 12, marginBottom: 4 }}>
							<span style={{ color: "#6b7280" }}>地址：</span>
							<span className="mono">{result.request_url}</span>
						</div>
						<div style={{ fontSize: 12, marginBottom: 6 }}>
							<span style={{ color: "#6b7280" }}>代理：</span>
							<span className="mono">{result.proxy ?? "直连"}</span>
						</div>
						<pre style={{ margin: 0, padding: "8px 10px", borderRadius: 6, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 11, overflow: "auto", maxHeight: 140 }}>
							{JSON.stringify(result.request_payload, null, 2)}
						</pre>
					</div>

					<div>
						<div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>响应</div>
						{result.status_reason && (
							<div style={{ fontSize: 12, marginBottom: 6, color: "#dc2626" }}>{result.status_reason}</div>
						)}
						<pre style={{ margin: 0, padding: "8px 10px", borderRadius: 6, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 11, overflow: "auto", maxHeight: 240, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
							{formatBody(result.response_body) || <span style={{ color: "#9ca3af" }}>（无响应体）</span>}
						</pre>
					</div>
				</>)}

				<div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
					<button onClick={onClose}>关闭</button>
				</div>
			</div>
		</div>
	);
}

interface ProxyOption {
	id: number;
	host: string;
	port: number;
	name: string | null;
}

function EditModal({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
	const [form, setForm] = useState({
		name: account.name ?? "",
		group_name: account.group_name ?? "",
		tier: account.tier,
		multiplier: account.multiplier,
		priority: account.priority ?? 0,
		total_capacity: account.total_capacity,
		expire_date: account.expire_date ?? "",
		proxy_id: account.proxy_id as number | null,
	});
	const [proxies, setProxies] = useState<ProxyOption[]>([]);

	useEffect(() => {
		api.get<{ items: ProxyOption[] }>("/api/admin/proxies").then((r) => setProxies(r.items));
	}, []);

	async function save() {
		await api.patch(`/api/admin/accounts/${account.id}`, {
			name: form.name || null,
			group_name: form.group_name || null,
			tier: form.tier,
			multiplier: Number(form.multiplier),
			priority: Number(form.priority),
			total_capacity: Number(form.total_capacity),
			expire_date: form.expire_date || null,
			proxy_id: form.proxy_id,
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
				<div className="field"><label>优先级</label><input type="number" min="0" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
				<div className="field"><label>总容量</label><input type="number" value={form.total_capacity} onChange={(e) => setForm({ ...form, total_capacity: Number(e.target.value) })} /></div>
				<div className="field"><label>到期日 (YYYY-MM-DD)</label><input value={form.expire_date} onChange={(e) => setForm({ ...form, expire_date: e.target.value })} /></div>
				<div className="field"><label>代理</label>
					<select value={form.proxy_id ?? ""} onChange={(e) => setForm({ ...form, proxy_id: e.target.value ? Number(e.target.value) : null })}>
						<option value="">无代理</option>
						{proxies.map((p) => (
							<option key={p.id} value={p.id}>
								#{p.id} — {p.host}:{p.port}{p.name ? ` (${p.name})` : ""}
							</option>
						))}
					</select>
				</div>
				<div className="row" style={{ justifyContent: "flex-end" }}>
					<button onClick={onClose}>取消</button>
					<button className="primary" onClick={save}>保存</button>
				</div>
			</div>
		</div>
	);
}

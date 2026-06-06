import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { OnboardPanel } from "./Onboard";

interface Account {
	id: number;
	provider: string;
	email: string | null;
	name: string | null;
	groups: string[];
	tier: string;
	quality_tier: number;
	status: string;
	status_reason: string | null;
	last_test_response: string | null;
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
	third_party_api_url: string | null;
	keep_active: number;
}

// Raw row as returned by the API: groups come back as a comma-joined string.
type AccountRaw = Omit<Account, "groups"> & { groups_csv: string | null };

function parseGroups(csv: string | null): string[] {
	if (!csv) return [];
	return csv.split(",").map((g) => g.trim()).filter(Boolean);
}

// Group name prefix decides its badge color (matches scheduling semantics):
// channel_* = strict binding, org_* = fallback-able, anything else = normal.
function groupBadgeClass(name: string): string {
	if (name.startsWith("channel_")) return "badge channel";
	if (name.startsWith("org_")) return "badge org";
	return "badge normal";
}

export function Accounts({ provider }: { provider: string }) {
	const [items, setItems] = useState<Account[]>([]);
	const [total, setTotal] = useState(0);
	const [filters, setFilters] = useState({ status: "", q: "", quality_tier: "" });
	const [loading, setLoading] = useState(false);
	const [editing, setEditing] = useState<Account | null>(null);
	const [testModal, setTestModal] = useState<{ account: Account; loading: boolean; result: TestResult | null; error: string | null } | null>(null);
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [bulkModal, setBulkModal] = useState<{ value: string } | null>(null);
	const [adding, setAdding] = useState(false);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			params.set("provider", provider);
			if (filters.status) params.set("status", filters.status);
			if (filters.q) params.set("q", filters.q);
			if (filters.quality_tier) params.set("quality_tier", filters.quality_tier);
			const r = await api.get<{ items: AccountRaw[]; total: number }>(`/api/admin/accounts?${params}`);
			const mapped = r.items.map((a) => ({ ...a, groups: parseGroups(a.groups_csv) }));
			setItems(mapped);
			setTotal(r.total);
			// drop selections of rows that disappeared
			setSelected((prev) => {
				const next = new Set<number>();
				for (const a of mapped) if (prev.has(a.id)) next.add(a.id);
				return next;
			});
		} finally {
			setLoading(false);
		}
	}, [filters, provider]);

	useEffect(() => {
		reload();
	}, [reload]);

	async function patch(id: number, body: Partial<Account>) {
		await api.patch(`/api/admin/accounts/${id}`, body);
		reload();
	}

	function toggleSelect(id: number) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	}

	function toggleSelectAll() {
		setSelected((prev) => prev.size === items.length ? new Set() : new Set(items.map((a) => a.id)));
	}

	async function applyBulkQualityTier() {
		if (!bulkModal) return;
		const qt = Number(bulkModal.value);
		if (!Number.isFinite(qt) || qt < 0) { alert("quality_tier 必须是 ≥ 0 的整数"); return; }
		await api.post(`/api/admin/accounts/bulk-quality-tier`, { ids: Array.from(selected), quality_tier: Math.trunc(qt) });
		setBulkModal(null);
		setSelected(new Set());
		reload();
	}

	async function remove(id: number) {
		if (!confirm(`删除账号 #${id}？`)) return;
		await api.delete(`/api/admin/accounts/${id}`);
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
			<h2>{provider === "claude" ? "Claude 号池" : "GPT 号池"} ({total})</h2>
			<div className="toolbar">
				<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
					<option value="">全部状态</option>
					<option value="active">active</option>
					<option value="paused">paused</option>
					<option value="problem">problem</option>
					<option value="exhausted">exhausted</option>
					<option value="terminated">terminated</option>
				</select>
				<select value={filters.quality_tier} onChange={(e) => setFilters({ ...filters, quality_tier: e.target.value })} title="质量 tier（用户 user_tier ≥ 此值才能用）">
					<option value="">全部 tier</option>
					{Array.from({ length: 11 }, (_, i) => <option key={i} value={String(i)}>tier {i}</option>)}
				</select>
				<input
					placeholder="邮箱 / 备注 / user_id"
					value={filters.q}
					onChange={(e) => setFilters({ ...filters, q: e.target.value })}
				/>
				<button onClick={reload} disabled={loading}>刷新</button>
				<button className="primary" onClick={() => setAdding(true)}>+ 添加</button>
				{selected.size > 0 && (
					<button className="primary" onClick={() => setBulkModal({ value: "0" })}>
						批量改 quality_tier ({selected.size})
					</button>
				)}
			</div>

			<div className="row" style={{ marginBottom: 12, fontSize: 13 }}>
				<label className="row" style={{ gap: 6, cursor: "pointer" }}>
					<input
						type="checkbox"
						checked={items.length > 0 && selected.size === items.length}
						onChange={toggleSelectAll}
					/>
					<span className="muted">全选 / 取消（已选 {selected.size}）</span>
				</label>
			</div>

			<div className="account-grid">
				{items.map((a) => (
					<div className={`account-card${selected.has(a.id) ? " selected" : ""}`} key={a.id}>
						<div className="account-card-head">
							<input
								type="checkbox"
								checked={selected.has(a.id)}
								onChange={() => toggleSelect(a.id)}
							/>
							<span className="mono muted">#{a.id}</span>
							<span className="account-card-email" title={a.email ?? undefined}>{a.email || "—"}</span>
							<span className={`badge ${a.status}`} title={a.last_test_response ?? a.status_reason ?? undefined} style={{ marginLeft: "auto" }}>{a.status}</span>
						</div>

						{a.name && <div className="muted" style={{ fontSize: 12 }}>{a.name}</div>}

						<div className="account-card-groups">
							{a.groups.length > 0
								? a.groups.map((g) => <span key={g} className={groupBadgeClass(g)}>{g}</span>)
								: <span className="muted" style={{ fontSize: 12 }}>共享池（无组）</span>}
						</div>

						<div className="account-card-meta">
							<span>套餐 <b>{a.tier}</b></span>
							<span title="quality_tier">QT <b>{a.quality_tier ?? 0}</b></span>
							<span>倍率 <b>{a.multiplier}</b></span>
							<span>优先级 <b>{a.priority ?? 0}</b></span>
							<span>绑定 keys <b>{a.kid_count}</b></span>
							<span className="mono">{a.created_at.slice(0, 10)}</span>
						</div>

						{a.third_party_api_url && (
							<div
								className="mono truncate"
								style={{ cursor: "pointer", fontSize: 11 }}
								title={`点击复制：${a.third_party_api_url}`}
								onClick={() => navigator.clipboard.writeText(a.third_party_api_url!)}
							>
								{a.third_party_api_url}
							</div>
						)}

						<label className="row" style={{ gap: 6, fontSize: 12 }}>
							<input
								type="checkbox"
								checked={a.keep_active === 1}
								onChange={() => patch(a.id, { keep_active: a.keep_active === 1 ? 0 : 1 })}
							/>
							<span className="muted" title="勾选后即使账号有问题也不会被下线">不下线</span>
						</label>

						<div className="row account-card-actions" style={{ gap: 4 }}>
							<button className="ghost" onClick={() => setEditing(a)}>编辑</button>
							<button className="ghost" onClick={() => testAccount(a)} title="发送探活请求，成功→active，失败→problem">探活</button>
							<button className="ghost" onClick={() => patch(a.id, { status: a.status === "paused" ? "active" : "paused" })}>{a.status === "paused" ? "启用" : "停用"}</button>
							<button className="ghost danger" onClick={() => remove(a.id)}>删除</button>
						</div>
					</div>
				))}
				{items.length === 0 && !loading && <div className="muted">暂无账号</div>}
			</div>

			{editing && <EditModal account={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
			{testModal && <TestModal state={testModal} onClose={() => setTestModal(null)} />}
			{adding && (
				<div className="modal-back" onClick={() => setAdding(false)}>
					<div className="modal" style={{ width: "min(680px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
						<div className="row" style={{ justifyContent: "space-between" }}>
							<h3 style={{ margin: 0 }}>添加账号</h3>
							<button className="ghost" onClick={() => setAdding(false)}>关闭</button>
						</div>
						<div className="muted" style={{ fontSize: 12, margin: "8px 0 16px" }}>
							上号后默认进共享池（无组），可在卡片「编辑」里设置组别（可多个）。
						</div>
						<OnboardPanel provider={provider} onDone={reload} />
					</div>
				</div>
			)}
			{bulkModal && (
				<div className="modal-back" onClick={() => setBulkModal(null)}>
					<div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
						<h3>批量改 quality_tier</h3>
						<div className="field">
							<label>新 quality_tier 值（0–10）</label>
							<input
								autoFocus
								type="number"
								min="0"
								max="10"
								step="1"
								value={bulkModal.value}
								onChange={(e) => setBulkModal({ value: e.target.value })}
								onKeyDown={(e) => { if (e.key === "Enter") applyBulkQualityTier(); }}
							/>
						</div>
						<div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
							将应用到选中的 {selected.size} 个账号
						</div>
						<div className="row" style={{ justifyContent: "flex-end" }}>
							<button onClick={() => setBulkModal(null)}>取消</button>
							<button className="primary" onClick={applyBulkQualityTier}>确认</button>
						</div>
					</div>
				</div>
			)}
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
		tier: account.tier,
		quality_tier: account.quality_tier ?? 0,
		multiplier: account.multiplier,
		priority: account.priority ?? 0,
		total_capacity: account.total_capacity,
		expire_date: account.expire_date ?? "",
		proxy_id: account.proxy_id as number | null,
	});
	const [groups, setGroups] = useState<string[]>(account.groups);
	const [groupInput, setGroupInput] = useState("");
	const [proxies, setProxies] = useState<ProxyOption[]>([]);

	useEffect(() => {
		api.get<{ items: ProxyOption[] }>("/api/admin/proxies").then((r) => setProxies(r.items));
	}, []);

	function addGroup() {
		const name = groupInput.trim().replace(/,$/, "").trim();
		if (name && !groups.includes(name)) setGroups([...groups, name]);
		setGroupInput("");
	}

	function removeGroup(name: string) {
		setGroups(groups.filter((g) => g !== name));
	}

	async function save() {
		await api.patch(`/api/admin/accounts/${account.id}`, {
			name: form.name || null,
			groups,
			tier: form.tier,
			quality_tier: Math.trunc(Number(form.quality_tier)),
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
				<div className="field">
					<label>组别（可多个；channel_* 严格绑定，org_* 可回落，其他普通）</label>
					<div className="tag-editor">
						{groups.map((g) => (
							<span key={g} className={`${groupBadgeClass(g)} tag-chip`}>
								{g}
								<button type="button" className="tag-chip-x" onClick={() => removeGroup(g)} aria-label="移除">×</button>
							</span>
						))}
						<input
							className="tag-input"
							value={groupInput}
							placeholder={groups.length ? "继续添加…" : "输入组名，回车添加"}
							onChange={(e) => setGroupInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addGroup(); }
								if (e.key === "Backspace" && !groupInput && groups.length) removeGroup(groups[groups.length - 1]);
							}}
							onBlur={addGroup}
						/>
					</div>
				</div>
				<div className="field"><label>tier (套餐档)</label>
					<select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
						<option value="free">free</option><option value="pro">pro</option><option value="max">max</option>
					</select>
				</div>
				<div className="field"><label>quality_tier (质量档，0-10；用户 user_tier 须 ≥ 此值才能用)</label>
					<input type="number" min="0" max="10" step="1" value={form.quality_tier} onChange={(e) => setForm({ ...form, quality_tier: Number(e.target.value) })} />
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

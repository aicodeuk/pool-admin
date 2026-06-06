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
	rpm_limit: number;
	rpm_current: number;
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

// Quick-edit RPM cap on a card: shows live RPM and an editable limit (0 = 不限).
// Commits on blur / Enter only when the value actually changed.
function RpmCell({ account, onPatch }: { account: Account; onPatch: (rpm_limit: number) => void }) {
	const [v, setV] = useState(String(account.rpm_limit ?? 0));
	useEffect(() => { setV(String(account.rpm_limit ?? 0)); }, [account.rpm_limit]);

	function commit() {
		const n = Math.max(0, Math.trunc(Number(v) || 0));
		if (n !== (account.rpm_limit ?? 0)) onPatch(n);
		else setV(String(account.rpm_limit ?? 0));
	}

	const over = account.rpm_limit > 0 && account.rpm_current >= account.rpm_limit;
	return (
		<div className="row" style={{ gap: 6, fontSize: 12 }} title="RPM = 每分钟请求数；上限 0 表示不限制，超限后新请求会分配其他账号">
			<span className="muted">RPM</span>
			<span>当前 <b style={{ color: over ? "#b91c1c" : undefined }}>{account.rpm_current ?? 0}</b></span>
			<span className="muted">上限</span>
			<input
				type="number"
				min="0"
				step="1"
				value={v}
				style={{ width: 64 }}
				onChange={(e) => setV(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
			/>
			{(account.rpm_limit ?? 0) === 0 && <span className="muted" style={{ fontSize: 11 }}>不限</span>}
		</div>
	);
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
	const [tab, setTab] = useState<"active" | "inactive">("active");
	// account_ids seen in today's ES index. null = ES unavailable/empty → don't
	// filter (show everything as active), per the fallback requirement.
	const [activeIds, setActiveIds] = useState<Set<number> | null>(null);

	const loadActiveIds = useCallback(async () => {
		try {
			const r = await api.get<{ accounts?: { account_id: number }[]; unconfigured?: boolean }>(
				`/api/admin/es-stats/accounts?provider=${provider}`,
			);
			if (r.unconfigured || !r.accounts || r.accounts.length === 0) { setActiveIds(null); return; }
			setActiveIds(new Set(r.accounts.map((a) => a.account_id)));
		} catch {
			setActiveIds(null); // ES down → fall back to showing all
		}
	}, [provider]);

	useEffect(() => { loadActiveIds(); }, [loadActiveIds]);

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

	function toggleSelectAll(visible: Account[]) {
		setSelected((prev) => {
			const allSelected = visible.length > 0 && visible.every((a) => prev.has(a.id));
			return allSelected ? new Set() : new Set(visible.map((a) => a.id));
		});
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

	// Partition into active (seen in today's ES index) vs inactive. When ES is
	// unavailable (activeIds === null) everything stays in the active tab.
	const haveEs = activeIds !== null;
	const activeItems = haveEs ? items.filter((a) => activeIds!.has(a.id)) : items;
	const inactiveItems = haveEs ? items.filter((a) => !activeIds!.has(a.id)) : [];
	const shown = tab === "active" ? activeItems : inactiveItems;

	return (
		<>
			<h2>
				{provider === "claude" ? "Claude 号池" : "GPT 号池"} ({total})
				<span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 12 }}>
					总 RPM <b style={{ color: "#111827" }}>{items.reduce((s, a) => s + (a.rpm_current ?? 0), 0)}</b>
				</span>
			</h2>
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
				<button onClick={() => { reload(); loadActiveIds(); }} disabled={loading}>刷新</button>
				<button className="primary" onClick={() => setAdding(true)}>+ 添加</button>
				{selected.size > 0 && (
					<button className="primary" onClick={() => setBulkModal({ value: "0" })}>
						批量改 quality_tier ({selected.size})
					</button>
				)}
			</div>

			<div className="tabs">
				<button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>
					活跃账号 ({activeItems.length})
				</button>
				<button className={tab === "inactive" ? "active" : ""} onClick={() => setTab("inactive")}>
					不活跃 ({inactiveItems.length})
				</button>
			</div>

			{!haveEs && (
				<div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
					ES 暂不可用或当天无记录，已显示全部账号。
				</div>
			)}

			<div className="row" style={{ marginBottom: 12, fontSize: 13 }}>
				<label className="row" style={{ gap: 6, cursor: "pointer" }}>
					<input
						type="checkbox"
						checked={shown.length > 0 && shown.every((a) => selected.has(a.id))}
						onChange={() => toggleSelectAll(shown)}
					/>
					<span className="muted">全选 / 取消（已选 {selected.size}）</span>
				</label>
			</div>

			<div className="account-grid">
				{shown.map((a) => (
					<div className={`account-card${selected.has(a.id) ? " selected" : ""}`} key={a.id}>
						<div className="account-card-head">
							<input
								type="checkbox"
								checked={selected.has(a.id)}
								onChange={() => toggleSelect(a.id)}
							/>
							<span className="mono muted">#{a.id}</span>
							<span className="account-card-email" title={a.name ?? undefined}>{a.name || "—"}</span>
							<span className={`badge ${a.status}`} title={a.last_test_response ?? a.status_reason ?? undefined} style={{ marginLeft: "auto" }}>{a.status}</span>
						</div>

						{a.email && <div className="muted" style={{ fontSize: 12 }}>{a.email}</div>}

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

						<RpmCell account={a} onPatch={(rpm_limit) => patch(a.id, { rpm_limit })} />

						<div className="row account-card-actions" style={{ gap: 4 }}>
							<button className="ghost" onClick={() => setEditing(a)}>编辑</button>
							<button className="ghost" onClick={() => testAccount(a)} title="发送探活请求，成功→active，失败→problem">探活</button>
							<button className="ghost" onClick={() => patch(a.id, { status: a.status === "paused" ? "active" : "paused" })}>{a.status === "paused" ? "启用" : "停用"}</button>
							<button className="ghost danger" onClick={() => remove(a.id)}>删除</button>
						</div>
					</div>
				))}
				{shown.length === 0 && !loading && <div className="muted">{tab === "active" ? "暂无活跃账号" : "暂无不活跃账号"}</div>}
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
		rpm_limit: account.rpm_limit ?? 0,
		keep_active: account.keep_active === 1,
	});
	const [groups, setGroups] = useState<string[]>(account.groups);
	const [groupInput, setGroupInput] = useState("");
	const [knownGroups, setKnownGroups] = useState<string[]>([]);
	const [proxies, setProxies] = useState<ProxyOption[]>([]);

	useEffect(() => {
		api.get<{ items: ProxyOption[] }>("/api/admin/proxies").then((r) => setProxies(r.items));
		api.get<{ groups: string[] }>(`/api/admin/accounts/groups?provider=${account.provider}`).then((r) => setKnownGroups(r.groups));
	}, [account.provider]);

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
			rpm_limit: Math.max(0, Math.trunc(Number(form.rpm_limit) || 0)),
			keep_active: form.keep_active ? 1 : 0,
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
							list="known-groups"
							value={groupInput}
							placeholder={groups.length ? "选择已有 / 输入新组别…" : "点击从已有组别选择，或输入新组别"}
							onChange={(e) => {
								const v = e.target.value;
								// Picking an existing group from the dropdown commits it immediately.
								if (knownGroups.includes(v)) {
									if (!groups.includes(v)) setGroups([...groups, v]);
									setGroupInput("");
								} else {
									setGroupInput(v);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addGroup(); }
								if (e.key === "Backspace" && !groupInput && groups.length) removeGroup(groups[groups.length - 1]);
							}}
							onBlur={addGroup}
						/>
						<datalist id="known-groups">
							{knownGroups.filter((g) => !groups.includes(g)).map((g) => <option key={g} value={g} />)}
						</datalist>
					</div>
					<span className="muted" style={{ fontSize: 11 }}>下拉可选历史组别；要新建直接输入后回车。</span>
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
				<div className="field"><label>RPM 上限（每分钟请求数，0 = 不限；超限后新请求分配其他账号。当前实时 {account.rpm_current ?? 0}）</label>
					<input type="number" min="0" step="1" value={form.rpm_limit} onChange={(e) => setForm({ ...form, rpm_limit: Number(e.target.value) })} />
				</div>
				<div className="field">
					<label className="row" style={{ gap: 8 }}>
						<input type="checkbox" style={{ width: "auto" }} checked={form.keep_active} onChange={(e) => setForm({ ...form, keep_active: e.target.checked })} />
						<span>不下线（勾选后即使账号有问题也保持 active，不会被自动下线）</span>
					</label>
				</div>
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

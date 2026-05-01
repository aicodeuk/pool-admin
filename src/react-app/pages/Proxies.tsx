import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Proxy {
	id: number;
	name: string | null;
	host: string;
	port: number;
	username: string | null;
	password: string | null;
	scheme: string;
	is_active: number;
	account_count: number;
}

interface TestResult {
	ok: boolean;
	ip?: string;
	city?: string;
	region?: string;
	country?: string;
	org?: string;
	latency_ms?: number;
	error?: string;
}

export function Proxies() {
	const [items, setItems] = useState<Proxy[]>([]);
	const [adding, setAdding] = useState(false);
	const [paste, setPaste] = useState("");
	const [testing, setTesting] = useState<number | null>(null);
	const [results, setResults] = useState<Record<number, TestResult>>({});

	async function reload() {
		const r = await api.get<{ items: Proxy[] }>("/api/admin/proxies");
		setItems(r.items);
	}
	useEffect(() => { reload(); }, []);

	async function add() {
		if (!paste.trim()) return;
		await api.post("/api/admin/proxies", { paste: paste.trim() });
		setPaste("");
		setAdding(false);
		reload();
	}

	async function toggle(p: Proxy) {
		await api.patch(`/api/admin/proxies/${p.id}`, { is_active: p.is_active ? 0 : 1 });
		reload();
	}

	async function remove(p: Proxy) {
		if (p.account_count > 0) return alert(`仍被 ${p.account_count} 个账号使用`);
		if (!confirm(`删除代理 ${p.host}:${p.port}？`)) return;
		await api.delete(`/api/admin/proxies/${p.id}`);
		reload();
	}

	async function test(p: Proxy) {
		setTesting(p.id);
		setResults((prev) => ({ ...prev, [p.id]: { ok: false, error: "检测中…" } }));
		try {
			const r = await api.post<TestResult>(`/api/admin/proxies/${p.id}/test`);
			setResults((prev) => ({ ...prev, [p.id]: r }));
		} catch (e) {
			setResults((prev) => ({ ...prev, [p.id]: { ok: false, error: (e as Error).message } }));
		} finally {
			setTesting(null);
		}
	}

	return (
		<>
			<h2>代理管理</h2>
			<div className="toolbar">
				<button className="primary" onClick={() => setAdding(true)}>+ 新增</button>
			</div>
			<div className="card" style={{ padding: 0 }}>
				<table>
					<thead>
						<tr>
							<th>ID</th><th>名称</th><th>地址</th><th>用户</th><th>scheme</th>
							<th>状态</th><th>账号数</th><th>IP 检测</th><th>操作</th>
						</tr>
					</thead>
					<tbody>
						{items.map((p) => (
							<tr key={p.id}>
								<td>{p.id}</td>
								<td>{p.name ?? "-"}</td>
								<td className="mono">{p.host}:{p.port}</td>
								<td className="mono">{p.username ?? "-"}</td>
								<td>{p.scheme}</td>
								<td><span className={`badge ${p.is_active ? "active" : "paused"}`}>{p.is_active ? "active" : "paused"}</span></td>
								<td>{p.account_count}</td>
								<td style={{ minWidth: 200 }}>
									<TestCell result={results[p.id]} />
								</td>
								<td>
									<div className="row" style={{ gap: 4 }}>
										<button
											className="ghost"
											onClick={() => test(p)}
											disabled={testing === p.id}
											title="通过该代理请求 ipinfo.io 检测连通性和 IP 归属"
										>
											{testing === p.id ? "…" : "检测"}
										</button>
										<button className="ghost" onClick={() => toggle(p)}>{p.is_active ? "停用" : "启用"}</button>
										<button className="ghost danger" onClick={() => remove(p)}>删</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{adding && (
				<div className="modal-back" onClick={() => setAdding(false)}>
					<div className="modal" onClick={(e) => e.stopPropagation()}>
						<h3>新增代理</h3>
						<div className="field">
							<label>粘贴格式 ip:port:user:pass</label>
							<input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="1.2.3.4:8080:user:pass" autoFocus />
						</div>
						<div className="row" style={{ justifyContent: "flex-end" }}>
							<button onClick={() => setAdding(false)}>取消</button>
							<button className="primary" onClick={add}>保存</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

function TestCell({ result }: { result: TestResult | undefined }) {
	if (!result) return <span className="muted" style={{ fontSize: 12 }}>—</span>;

	if (!result.ok) {
		return (
			<span style={{ fontSize: 12, color: "#b91c1c" }} title={result.error}>
				✗ {result.error?.slice(0, 40)}
			</span>
		);
	}

	const location = [result.city, result.region, result.country].filter(Boolean).join(", ");
	const orgShort = result.org?.replace(/^AS\d+\s+/, "").slice(0, 24);

	return (
		<div style={{ fontSize: 12, lineHeight: 1.6 }}>
			<div style={{ color: "#047857", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
				✓ {result.ip}
				<span style={{ color: "#6b7280", fontWeight: 400, marginLeft: 6 }}>{result.latency_ms}ms</span>
			</div>
			{location && <div className="muted">{location}</div>}
			{orgShort && <div className="muted">{orgShort}</div>}
		</div>
	);
}

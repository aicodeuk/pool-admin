import { useState } from "react";
import { api } from "../lib/api";

// ── types ──────────────────────────────────────────────────────────────────

interface ProxyConfig {
	host: string;
	port: number;
	username?: string | null;
	password?: string | null;
	scheme?: "http" | "socks5";
}

interface StartResp {
	authorize_url: string;
	state: string;
	verifier: string;
	proxy: ProxyConfig;
}

interface ApiKeyResult {
	key?: string;
	id?: number;
	email?: string;
	proxy_id?: number | null;
	skipped?: boolean;
	error?: string;
}

// ── helpers ────────────────────────────────────────────────────────────────

function isProxyLine(s: string): boolean {
	return !s.startsWith("sk-") && !s.startsWith("sk_") && /^[\w.\-]+:\d+/.test(s);
}

function parseApiKeyInput(text: string): Array<{ key: string; proxy: string | null }> {
	const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

	// If the last line looks like a proxy (not a sk- key), treat it as the shared proxy
	// that applies to all keys which don't have their own per-line proxy.
	let sharedProxy: string | null = null;
	if (lines.length > 0 && isProxyLine(lines[lines.length - 1])) {
		sharedProxy = lines[lines.length - 1];
		lines.pop();
	}

	const entries: Array<{ key: string; proxy: string | null }> = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("sk-") || line.startsWith("sk_")) {
			const next = lines[i + 1];
			if (next && isProxyLine(next)) {
				// per-key proxy overrides the shared one
				entries.push({ key: line, proxy: next });
				i++;
			} else {
				entries.push({ key: line, proxy: sharedProxy });
			}
		}
	}
	return entries;
}

// ── Claude OAuth tab ───────────────────────────────────────────────────────

function OAuthTab() {
	const [proxy, setProxy] = useState("");
	const [name, setName] = useState("");
	const [stage, setStage] = useState<"init" | "await-code" | "done">("init");
	const [start, setStart] = useState<StartResp | null>(null);
	const [code, setCode] = useState("");
	const [email, setEmail] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ id: number; email: string; proxy_id: number } | null>(null);

	async function begin() {
		setError(null);
		setBusy(true);
		try {
			const r = await api.post<StartResp>("/api/admin/onboard/start", { proxy });
			setStart(r);
			setStage("await-code");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function complete() {
		if (!start) return;
		setError(null);
		setBusy(true);
		try {
			const r = await api.post<{ id: number; email: string; proxy_id: number }>(
				"/api/admin/onboard/complete",
				{ proxy: start.proxy, state: start.state, verifier: start.verifier, code, email: email || undefined, name: name || undefined },
			);
			setResult(r);
			setStage("done");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	function reset() {
		setStage("init"); setStart(null); setCode(""); setProxy(""); setName(""); setEmail(""); setResult(null); setError(null);
	}

	return (
		<>
			{stage === "init" && (
				<div className="card">
					<div className="field">
						<label>HTTP 代理 (ip:port:user:pass)</label>
						<input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="1.2.3.4:8080:user:pass" />
					</div>
					<div className="field">
						<label>备注（可选）</label>
						<input value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<button className="primary" onClick={begin} disabled={busy || !proxy.trim()}>{busy ? "请稍候…" : "生成授权链接"}</button>
					{error && <div className="error">{error}</div>}
				</div>
			)}

			{stage === "await-code" && start && (
				<div className="card">
					<div className="field">
						<label>1. 浏览器请通过该代理访问下面链接完成授权：</label>
						<input readOnly value={start.authorize_url} onFocus={(e) => e.target.select()} />
						<div className="muted" style={{ fontSize: 12, marginTop: 4 }}>代理：http://{start.proxy.host}:{start.proxy.port}</div>
					</div>
					<div className="field">
						<label>2. 把回调 URL 或授权码粘贴到这里</label>
						<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://platform.claude.com/oauth/code/callback?code=…&state=…" />
					</div>
					<div className="field">
						<label>邮箱（可选，留空自动解析）</label>
						<input value={email} onChange={(e) => setEmail(e.target.value)} />
					</div>
					<div className="row">
						<button onClick={reset}>重新开始</button>
						<button className="primary" onClick={complete} disabled={busy || !code.trim()}>{busy ? "交换中…" : "完成上号"}</button>
					</div>
					{error && <div className="error">{error}</div>}
				</div>
			)}

			{stage === "done" && result && (
				<div className="card">
					<h3 style={{ marginTop: 0 }}>上号成功 ✓</h3>
					<div className="mono">
						<div>account_id: {result.id}</div>
						<div>email: {result.email}</div>
						<div>proxy_id: {result.proxy_id}</div>
					</div>
					<div className="row" style={{ marginTop: 16 }}>
						<button className="primary" onClick={reset}>继续上号</button>
					</div>
				</div>
			)}
		</>
	);
}

// ── Official API Key tab ───────────────────────────────────────────────────

function ApiKeyTab() {
	const [text, setText] = useState("");
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [results, setResults] = useState<{ added: number; skipped: number; errors: number; items: ApiKeyResult[] } | null>(null);

	const parsed = parseApiKeyInput(text);

	async function submit() {
		if (parsed.length === 0) return;
		setError(null);
		setBusy(true);
		try {
			const r = await api.post<{ results: ApiKeyResult[]; added: number; skipped: number; errors: number }>(
				"/api/admin/onboard/api-key",
				{
					entries: parsed.map((e) => ({ key: e.key, proxy: e.proxy ?? undefined })),
					name: name.trim() || undefined,
				},
			);
			setResults({ added: r.added, skipped: r.skipped, errors: r.errors, items: r.results });
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	function reset() {
		setText(""); setName(""); setResults(null); setError(null);
	}

	if (results) {
		return (
			<div className="card">
				<h3 style={{ marginTop: 0 }}>
					导入完成 — 新增 {results.added}，跳过 {results.skipped}，失败 {results.errors}
				</h3>
				<table>
					<thead><tr><th>key（末12位）</th><th>状态</th><th>account_id</th><th>proxy_id</th></tr></thead>
					<tbody>
						{results.items.map((r, i) => (
							<tr key={i}>
								<td className="mono">{r.email ?? r.key ?? "—"}</td>
								<td>
									{r.error
										? <span className="badge problem">{r.error}</span>
										: r.skipped
											? <span className="badge paused">已存在</span>
											: <span className="badge active">新增</span>}
								</td>
								<td>{r.id ?? "—"}</td>
								<td>{r.proxy_id != null ? r.proxy_id : "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
				<div className="row" style={{ marginTop: 16 }}>
					<button className="primary" onClick={reset}>继续导入</button>
				</div>
			</div>
		);
	}

	return (
		<div className="card">
			<div className="field">
				<label>API Key（每行一个；末尾加一行代理则所有 key 共用；也可在某个 key 下一行单独指定代理）</label>
				<textarea
					rows={8}
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder={"sk-ant-api03-xxxxx\nsk-ant-api03-yyyyy\nsk-ant-api03-zzzzz\n192.46.188.53:5712:grxirowy:owo6qigofgnx"}
					style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
				/>
				{text && parsed.length > 0 && (
					<span className="muted" style={{ fontSize: 11 }}>
						识别到 {parsed.length} 个 key，
						{parsed.filter((e) => e.proxy).length > 0
							? `${parsed.filter((e) => e.proxy).length} 个带代理（${parsed[0].proxy?.split(":").slice(0, 2).join(":")}）`
							: "不走代理"}
					</span>
				)}
			</div>
			<div className="field">
				<label>备注（可选，批量统一备注）</label>
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="来源 / 用途" />
			</div>
			<button className="primary" onClick={submit} disabled={busy || parsed.length === 0}>
				{busy ? "导入中…" : `导入 ${parsed.length} 个 key`}
			</button>
			{error && <div className="error">{error}</div>}
		</div>
	);
}

// ── Third-party relay tab ──────────────────────────────────────────────────

interface RelayEntry { key: string; url: string; }

function parseRelayInput(text: string): RelayEntry[] {
	const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
	const entries: RelayEntry[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// JSON format: {"_type":"newapi_channel_conn","key":"...","url":"..."}
		if (line.startsWith("{")) {
			try {
				const obj = JSON.parse(line) as Record<string, unknown>;
				const key = String(obj.key ?? "").trim();
				const url = String(obj.url ?? "").trim();
				if (key && url) entries.push({ key, url });
			} catch { /* skip malformed */ }
			continue;
		}
		// Plain text: key line then url line
		const next = lines[i + 1];
		if (next && (next.startsWith("http://") || next.startsWith("https://"))) {
			entries.push({ key: line, url: next });
			i++;
		}
	}
	return entries;
}

function RelayTab() {
	const [text, setText] = useState("");
	const [provider, setProvider] = useState("claude");
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [results, setResults] = useState<{ added: number; skipped: number; errors: number; items: ApiKeyResult[] } | null>(null);

	const parsed = parseRelayInput(text);

	async function submit() {
		if (parsed.length === 0) return;
		setError(null);
		setBusy(true);
		try {
			const r = await api.post<{ results: ApiKeyResult[]; added: number; skipped: number; errors: number }>(
				"/api/admin/onboard/relay",
				{ entries: parsed, provider, name: name.trim() || undefined },
			);
			setResults({ added: r.added, skipped: r.skipped, errors: r.errors, items: r.results });
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	function reset() {
		setText(""); setName(""); setResults(null); setError(null);
	}

	if (results) {
		return (
			<div className="card">
				<h3 style={{ marginTop: 0 }}>
					导入完成 — 新增 {results.added}，跳过 {results.skipped}，失败 {results.errors}
				</h3>
				<table>
					<thead><tr><th>标识</th><th>URL</th><th>状态</th><th>account_id</th></tr></thead>
					<tbody>
						{results.items.map((r, i) => (
							<tr key={i}>
								<td className="mono">{r.email ?? "—"}</td>
								<td className="mono truncate">{(r as Record<string, unknown>).url as string ?? "—"}</td>
								<td>
									{r.error
										? <span className="badge problem">{r.error}</span>
										: r.skipped
											? <span className="badge paused">已存在</span>
											: <span className="badge active">新增</span>}
								</td>
								<td>{r.id ?? "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
				<div className="row" style={{ marginTop: 16 }}>
					<button className="primary" onClick={reset}>继续导入</button>
				</div>
			</div>
		);
	}

	return (
		<div className="card">
			<div className="field">
				<label>数据（JSON 格式或每行 key / 下行 url，可批量）</label>
				<textarea
					rows={10}
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder={`{"_type":"newapi_channel_conn","key":"sk-xxx","url":"https://api.aigcdesk.com"}\n{"_type":"newapi_channel_conn","key":"sk-yyy","url":"https://other.example.com"}\n\n或者：\nsk-k9Z2qLK6...\nhttps://api.aigcdesk.com`}
					style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
				/>
				{text && (
					<span className="muted" style={{ fontSize: 11 }}>
						识别到 {parsed.length} 条（key + url）
					</span>
				)}
			</div>
			<div className="field">
				<label>Provider</label>
				<select value={provider} onChange={(e) => setProvider(e.target.value)}>
					<option value="claude">claude</option>
					<option value="gpt">gpt</option>
					<option value="gemini">gemini</option>
				</select>
			</div>
			<div className="field">
				<label>备注（可选）</label>
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="来源 / 渠道名" />
			</div>
			<button className="primary" onClick={submit} disabled={busy || parsed.length === 0}>
				{busy ? "导入中…" : `导入 ${parsed.length} 条`}
			</button>
			{error && <div className="error">{error}</div>}
		</div>
	);
}

// ── Main component ─────────────────────────────────────────────────────────

export function Onboard() {
	const [tab, setTab] = useState<"oauth" | "apikey" | "relay">("oauth");

	return (
		<>
			<h2>上号</h2>
			<div className="tabs">
				<button className={tab === "oauth" ? "active" : ""} onClick={() => setTab("oauth")}>Claude OAuth</button>
				<button className={tab === "apikey" ? "active" : ""} onClick={() => setTab("apikey")}>官方 API Key</button>
				<button className={tab === "relay" ? "active" : ""} onClick={() => setTab("relay")}>第三方中转</button>
			</div>
			{tab === "oauth" && <OAuthTab />}
			{tab === "apikey" && <ApiKeyTab />}
			{tab === "relay" && <RelayTab />}
		</>
	);
}

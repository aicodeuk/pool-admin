import { useState } from "react";
import { api } from "../lib/api";

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

export function Onboard() {
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
				{
					proxy: start.proxy,
					state: start.state,
					verifier: start.verifier,
					code,
					email: email || undefined,
					name: name || undefined,
				},
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
			<h2>上号（Claude OAuth）</h2>

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

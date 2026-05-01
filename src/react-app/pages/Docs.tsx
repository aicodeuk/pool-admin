const BASE = typeof window !== "undefined" ? window.location.origin : "https://your-worker.workers.dev";

const ENDPOINTS = [
	{
		name: "Claude",
		path: "/v2/internal/sync-x7k9m2p4/accounts-batch-q3n8r5",
		sigEnvVar: "API_SECRET_KEY",
		sigHeader: "X-API-Signature",
	},
	{
		name: "GPT",
		path: "/v2/internal/gpt-m9k3n7q2/accounts-batch-p5r2t8",
		sigEnvVar: "GPT_API_SECRET_KEY",
		sigHeader: "X-API-Signature",
	},
	{
		name: "Gemini",
		path: "/v2/internal/gemini-k8j2m5x1/accounts-batch-x9k7n4",
		sigEnvVar: "GPT_API_SECRET_KEY",
		sigHeader: "X-API-Signature",
		note: "复用 GPT_API_SECRET_KEY",
	},
];

const ACCOUNT_RESP = `{
  "id": 42,
  "access_token": "sk-ant-api03-...",
  "has_claude_max": false,
  "device": "linux",
  "proxy": "http://user:pass@1.2.3.4:8080",
  "level": 1,
  "is_dedicated": true,
  "multiplier": 4.0,
  "is_third_party": false,

  // 仅 is_third_party=true 时出现:
  "third_party_api_url": "https://api.anthropic.com",

  // 有值时出现:
  "user_id": "user_7f4b...",
  "project": null
}`;

const LIST_RESP = `[
  { "id": 10, "access_token": "...", "proxy": "http://...", ... },
  { "id": 11, "access_token": "...", "proxy": "http://...", ... }
]`;

function Code({ children }: { children: string }) {
	return (
		<pre style={{
			background: "#f8fafc",
			border: "1px solid #e5e7eb",
			borderRadius: 6,
			padding: "12px 14px",
			fontSize: 12,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			overflowX: "auto",
			margin: "6px 0 0",
			color: "#1e293b",
			lineHeight: 1.6,
			whiteSpace: "pre",
		}}>{children}</pre>
	);
}

function Tag({ children, color }: { children: string; color: string }) {
	return (
		<span style={{
			display: "inline-block",
			padding: "1px 7px",
			borderRadius: 4,
			fontSize: 11,
			fontWeight: 600,
			background: color === "blue" ? "#eff6ff" : "#f0fdf4",
			color: color === "blue" ? "#1d4ed8" : "#15803d",
			marginLeft: 6,
		}}>{children}</span>
	);
}

export function Docs() {
	return (
		<div style={{ maxWidth: 860 }}>
			<h2 style={{ marginBottom: 4 }}>接口文档</h2>
			<p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
				Worker 地址：<code style={{ fontSize: 13 }}>{BASE}</code>
			</p>

			{/* ── 认证说明 ─────────────────────────────────── */}
			<div className="card" style={{ marginBottom: 24 }}>
				<h3 style={{ marginTop: 0, marginBottom: 12 }}>认证方式</h3>
				<p style={{ margin: "0 0 10px", fontSize: 14 }}>
					所有接口使用 <strong>固定密钥</strong> 认证，密钥通过请求头传递：
				</p>
				<Code>{"GET /v2/internal/...\nX-API-Signature: <密钥>"}</Code>
				<p style={{ margin: "12px 0 8px", fontSize: 14 }}>密钥在 Cloudflare Workers 控制台 → Settings → Variables 中配置：</p>
				<table style={{ fontSize: 13 }}>
					<thead>
						<tr><th>环境变量</th><th>用于接口</th><th>配置命令</th></tr>
					</thead>
					<tbody>
						<tr>
							<td className="mono">API_SECRET_KEY</td>
							<td>Claude、Gemini</td>
							<td><code style={{ fontSize: 12 }}>wrangler secret put API_SECRET_KEY</code></td>
						</tr>
						<tr>
							<td className="mono">GPT_API_SECRET_KEY</td>
							<td>GPT、Gemini</td>
							<td><code style={{ fontSize: 12 }}>wrangler secret put GPT_API_SECRET_KEY</code></td>
						</tr>
					</tbody>
				</table>
			</div>

			{/* ── 3 个接口 ─────────────────────────────────── */}
			{ENDPOINTS.map((ep) => (
				<div key={ep.name} className="card" style={{ marginBottom: 20 }}>
					<h3 style={{ marginTop: 0, marginBottom: 12 }}>
						{ep.name} 账号分配
						{ep.note && <Tag color="green">{ep.note}</Tag>}
					</h3>

					<div className="field">
						<label>接口地址</label>
						<Code>{`GET ${BASE}${ep.path}`}</Code>
					</div>

					<div className="field">
						<label>认证头</label>
						<Code>{`${ep.sigHeader}: $${ep.sigEnvVar}`}</Code>
					</div>

					<div className="field" style={{ marginBottom: 0 }}>
						<label>请求参数（Query）</label>
						<table style={{ fontSize: 13, marginTop: 6 }}>
							<thead>
								<tr><th style={{ width: 120 }}>参数</th><th style={{ width: 80 }}>必填</th><th>说明</th></tr>
							</thead>
							<tbody>
								<tr>
									<td className="mono">kid</td>
									<td><Tag color="green">可选</Tag></td>
									<td>API Key 的数字 ID。<strong>不传</strong>时返回所有可用共享账号列表；<strong>传入</strong>时分配并返回单个账号。</td>
								</tr>
								<tr>
									<td className="mono">force_replace</td>
									<td><Tag color="green">可选</Tag></td>
									<td><code>true</code> 时强制重新分配（配合 <code>aid</code> 使用）。</td>
								</tr>
								<tr>
									<td className="mono">aid</td>
									<td><Tag color="green">可选</Tag></td>
									<td>出问题的账号 ID。当 <code>force_replace=true</code> 时，该账号会被标记为 problem。</td>
								</tr>
								<tr>
									<td className="mono">is_max</td>
									<td><Tag color="green">可选</Tag></td>
									<td><code>1</code> / <code>true</code> 限定 max tier 账号；<code>0</code> / 不传 不限制。</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			))}

			{/* ── 响应格式 ─────────────────────────────────── */}
			<div className="card" style={{ marginBottom: 20 }}>
				<h3 style={{ marginTop: 0, marginBottom: 12 }}>响应格式</h3>

				<div className="field">
					<label>传入 kid → 单个账号对象</label>
					<Code>{ACCOUNT_RESP}</Code>
				</div>

				<div className="field" style={{ marginBottom: 0 }}>
					<label>不传 kid → 账号数组（共享池列表）</label>
					<Code>{LIST_RESP}</Code>
				</div>
			</div>

			{/* ── 分配逻辑 ─────────────────────────────────── */}
			<div className="card" style={{ marginBottom: 20 }}>
				<h3 style={{ marginTop: 0, marginBottom: 12 }}>分配逻辑（传入 kid 时）</h3>
				<ol style={{ fontSize: 14, lineHeight: 2, paddingLeft: 20, margin: 0 }}>
					<li>
						查 <strong>kid_groups</strong> 表，若该 kid 绑定了组：
						<ul style={{ marginTop: 4 }}>
							<li><code>channel_*</code> — 严格模式，组内无可用账号直接返回 404</li>
							<li><code>org_*</code> — 宽松模式，组内无账号时 fallback 到 <code>channel_max / channel_aws_chip / channel_api</code></li>
							<li>其他组名 — 组内无账号则继续往下走</li>
						</ul>
					</li>
					<li>查 <strong>kid_mappings</strong> 已有 mapping，若账号仍 active 且满足 is_max 条件则直接复用。</li>
					<li>从 <strong>共享池</strong>（group_name 为空、is_third_party=0、available_count&gt;0）随机挑选。</li>
					<li>共享池也无可用账号 → fallback 到 <strong>第三方中转</strong>（is_third_party=1）。</li>
					<li>全部耗尽 → 返回 <code>404 No available accounts</code>。</li>
				</ol>
			</div>

			{/* ── 快速测试 ─────────────────────────────────── */}
			<div className="card">
				<h3 style={{ marginTop: 0, marginBottom: 12 }}>快速测试（curl）</h3>
				<div className="field">
					<label>分配单个 Claude 账号（kid=1234）</label>
					<Code>{`curl -s "${BASE}/v2/internal/sync-x7k9m2p4/accounts-batch-q3n8r5?kid=1234" \\
  -H "X-API-Signature: <API_SECRET_KEY>" | jq .`}</Code>
				</div>
				<div className="field">
					<label>上报账号异常 + 强制换号（aid=42 有问题，kid=1234 重新分配）</label>
					<Code>{`curl -s "${BASE}/v2/internal/sync-x7k9m2p4/accounts-batch-q3n8r5?kid=1234&force_replace=true&aid=42" \\
  -H "X-API-Signature: <API_SECRET_KEY>" | jq .`}</Code>
				</div>
				<div className="field" style={{ marginBottom: 0 }}>
					<label>获取所有可用 GPT 共享账号</label>
					<Code>{`curl -s "${BASE}/v2/internal/gpt-m9k3n7q2/accounts-batch-p5r2t8" \\
  -H "X-API-Signature: <GPT_API_SECRET_KEY>" | jq .`}</Code>
				</div>
			</div>
		</div>
	);
}

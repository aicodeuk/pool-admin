import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface CronConfig {
	job: string;
	enabled: number;
	updated_at: string;
	last_run: {
		started_at: string;
		finished_at: string | null;
		duration_ms: number | null;
		status: string;
		result_json: string | null;
		error_text: string | null;
	} | null;
}

interface CronLog {
	id: number;
	job: string;
	started_at: string;
	finished_at: string | null;
	duration_ms: number | null;
	status: string;
	result_json: string | null;
	error_text: string | null;
}

const JOB_LABELS: Record<string, string> = {
	status_sync: "探活恢复 (每分钟)",
	token_refresh: "Token 刷新 (每10分钟)",
	usage_sync: "用量同步 (每30分钟)",
};

function formatMs(ms: number | null): string {
	if (ms == null) return "—";
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function parseResult(json: string | null): string {
	if (!json) return "—";
	try {
		const obj = JSON.parse(json) as Record<string, unknown>;
		return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join("  ");
	} catch {
		return json.slice(0, 80);
	}
}

export function Cron() {
	const [configs, setConfigs] = useState<CronConfig[]>([]);
	const [logs, setLogs] = useState<CronLog[]>([]);
	const [logJob, setLogJob] = useState("");
	const [running, setRunning] = useState<string | null>(null);
	const [runResult, setRunResult] = useState<{ job: string; ok: boolean; text: string } | null>(null);

	async function reload() {
		const [c, l] = await Promise.all([
			api.get<{ configs: CronConfig[] }>("/api/admin/cron"),
			api.get<{ items: CronLog[] }>(`/api/admin/cron/logs${logJob ? `?job=${logJob}` : ""}`),
		]);
		setConfigs(c.configs);
		setLogs(l.items);
	}

	useEffect(() => { reload(); }, [logJob]); // eslint-disable-line react-hooks/exhaustive-deps

	async function toggle(job: string, enabled: boolean) {
		await api.patch(`/api/admin/cron/${job}`, { enabled });
		reload();
	}

	async function trigger(job: string) {
		setRunning(job);
		setRunResult(null);
		try {
			const r = await api.post<{ ok: boolean; result: unknown }>(`/api/admin/cron/${job}/run`);
			setRunResult({ job, ok: r.ok, text: r.result ? JSON.stringify(r.result) : "ok" });
			reload();
		} catch (e) {
			setRunResult({ job, ok: false, text: (e as Error).message });
		} finally {
			setRunning(null);
		}
	}

	return (
		<>
			<h2>定时任务</h2>

			{runResult && (
				<div style={{ padding: "8px 12px", marginBottom: 12, borderRadius: 6, border: "1px solid", fontSize: 13, background: runResult.ok ? "#ecfdf5" : "#fef2f2", borderColor: runResult.ok ? "#6ee7b7" : "#fca5a5" }}>
					{runResult.ok ? "✓" : "✗"} {JOB_LABELS[runResult.job] ?? runResult.job}：{runResult.text}
					<button className="ghost" style={{ marginLeft: 8, padding: "2px 6px", fontSize: 11 }} onClick={() => setRunResult(null)}>✕</button>
				</div>
			)}

			<div className="card" style={{ padding: 0, marginBottom: 20 }}>
				<table>
					<thead>
						<tr>
							<th>任务</th><th>状态</th><th>最近运行</th><th>耗时</th><th>结果</th><th>操作</th>
						</tr>
					</thead>
					<tbody>
						{configs.map((cfg) => (
							<tr key={cfg.job}>
								<td>{JOB_LABELS[cfg.job] ?? cfg.job}</td>
								<td>
									<span className={`badge ${cfg.enabled ? "active" : "paused"}`}>
										{cfg.enabled ? "启用" : "停用"}
									</span>
								</td>
								<td className="mono">{cfg.last_run?.started_at ?? <span className="muted">从未运行</span>}</td>
								<td className="mono">{formatMs(cfg.last_run?.duration_ms ?? null)}</td>
								<td style={{ maxWidth: 260 }}>
									{cfg.last_run?.status === "error"
										? <span className="badge problem" title={cfg.last_run.error_text ?? ""}>{cfg.last_run.error_text?.slice(0, 60) ?? "error"}</span>
										: <span className="muted" style={{ fontSize: 12 }}>{parseResult(cfg.last_run?.result_json ?? null)}</span>}
								</td>
								<td>
									<div className="row" style={{ gap: 4 }}>
										<button
											className="ghost"
											onClick={() => trigger(cfg.job)}
											disabled={running === cfg.job}
											title="立即执行一次（即使已停用）"
										>
											{running === cfg.job ? "运行中…" : "立即运行"}
										</button>
										<button
											className={`ghost${cfg.enabled ? " danger" : ""}`}
											onClick={() => toggle(cfg.job, !cfg.enabled)}
										>
											{cfg.enabled ? "停用" : "启用"}
										</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="toolbar">
				<h3 style={{ margin: 0, flex: 1 }}>运行日志</h3>
				<select value={logJob} onChange={(e) => setLogJob(e.target.value)}>
					<option value="">全部任务</option>
					{Object.entries(JOB_LABELS).map(([k, v]) => (
						<option key={k} value={k}>{v}</option>
					))}
				</select>
				<button onClick={reload}>刷新</button>
			</div>

			<div className="card" style={{ padding: 0 }}>
				<table>
					<thead>
						<tr><th>ID</th><th>任务</th><th>开始时间</th><th>耗时</th><th>状态</th><th>结果 / 错误</th></tr>
					</thead>
					<tbody>
						{logs.map((log) => (
							<tr key={log.id}>
								<td>{log.id}</td>
								<td><span className="muted" style={{ fontSize: 12 }}>{JOB_LABELS[log.job] ?? log.job}</span></td>
								<td className="mono">{log.started_at}</td>
								<td className="mono">{formatMs(log.duration_ms)}</td>
								<td>
									<span className={`badge ${log.status === "ok" ? "active" : log.status === "error" ? "problem" : "paused"}`}>
										{log.status}
									</span>
								</td>
								<td style={{ fontSize: 12, color: log.error_text ? "#b91c1c" : "#6b7280", maxWidth: 320 }}>
									{log.error_text ?? parseResult(log.result_json)}
								</td>
							</tr>
						))}
						{logs.length === 0 && (
							<tr><td colSpan={6} style={{ textAlign: "center", color: "#9ca3af", padding: 24 }}>暂无日志</td></tr>
						)}
					</tbody>
				</table>
			</div>
		</>
	);
}

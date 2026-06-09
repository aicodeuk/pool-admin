import type { ReactNode } from "react";
import { api } from "../lib/api";

interface NavItem {
	id: string;
	label: string;
}

const NAV: NavItem[] = [
	{ id: "dashboard", label: "仪表盘" },
	{ id: "claude-stats", label: "Claude 调用统计" },
	{ id: "gpt-stats", label: "GPT 调用统计" },
	{ id: "risk", label: "风险分析" },
	{ id: "shared-sessions", label: "多号检测" },
	{ id: "claude-accounts", label: "Claude 号池" },
	{ id: "gpt-accounts", label: "GPT 号池" },
	{ id: "proxies", label: "代理" },
	{ id: "kid-groups", label: "Kid 绑定" },
	{ id: "kid-mappings", label: "Kid 映射" },
	{ id: "onboard", label: "上号" },
	{ id: "cron", label: "定时任务" },
	{ id: "docs", label: "接口文档" },
	{ id: "audit", label: "审计" },
	{ id: "sync-logs", label: "请求日志" },
];

interface Props {
	current: string;
	onNavigate: (id: string) => void;
	onLogout: () => void;
	children: ReactNode;
}

export function Layout({ current, onNavigate, onLogout, children }: Props) {
	return (
		<div className="layout">
			<aside className="sidebar">
				<h1>Pool Admin</h1>
				<nav>
					{NAV.map((n) => (
						<a
							key={n.id}
							href={`#${n.id}`}
							className={current === n.id ? "active" : ""}
							onClick={(e) => {
								e.preventDefault();
								onNavigate(n.id);
							}}
						>
							{n.label}
						</a>
					))}
				</nav>
				<div className="footer">
					<a
						href="#"
						onClick={async (e) => {
							e.preventDefault();
							await api.post("/api/admin/logout");
							onLogout();
						}}
					>
						退出登录
					</a>
				</div>
			</aside>
			<main className="main">{children}</main>
		</div>
	);
}

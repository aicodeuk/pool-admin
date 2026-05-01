import { Hono } from "hono";

import { adminAuth } from "./lib/auth";
import { authRoutes } from "./routes/admin/auth";
import { statsRoutes } from "./routes/admin/stats";
import { accountRoutes } from "./routes/admin/accounts";
import { proxyRoutes } from "./routes/admin/proxies";
import { kidGroupRoutes } from "./routes/admin/kid-groups";
import { kidMappingRoutes } from "./routes/admin/kid-mappings";
import { auditRoutes } from "./routes/admin/audit";
import { onboardRoutes } from "./routes/admin/onboard";
import { claudeSync, geminiSync, gptSync } from "./routes/v2/sync";

import { refreshExpiringTokens } from "./cron/token-refresh";
import { syncUsage } from "./cron/usage-sync";
import { syncStatus } from "./cron/status-sync";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// Public auth (login/logout/me)
app.route("/api/admin", authRoutes);

// Authenticated admin API
const admin = new Hono<{ Bindings: Env }>();
admin.use("*", adminAuth());
admin.get("/me", (c) => c.json({ ok: true, actor: "admin" }));
admin.route("/stats", statsRoutes);
admin.route("/accounts", accountRoutes);
admin.route("/proxies", proxyRoutes);
admin.route("/kid-groups", kidGroupRoutes);
admin.route("/kid-mappings", kidMappingRoutes);
admin.route("/audit", auditRoutes);
admin.route("/onboard", onboardRoutes);
app.route("/api/admin", admin);

// V2 sync API (signed, wire-compatible with the original Go service)
app.route("/v2/internal/sync-x7k9m2p4", claudeSync);
app.route("/v2/internal/gpt-m9k3n7q2", gptSync);
app.route("/v2/internal/gemini-k8j2m5x1", geminiSync);

export default {
	fetch: app.fetch,
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const cron = event.cron;
		ctx.waitUntil(
			(async () => {
				try {
					if (cron === "* * * * *") {
						await syncStatus(env);
					} else if (cron === "*/10 * * * *") {
						await refreshExpiringTokens(env);
					} else if (cron === "*/30 * * * *") {
						await syncUsage(env);
					}
				} catch (e) {
					console.error(`cron ${cron} failed:`, e);
				}
			})(),
		);
	},
} satisfies ExportedHandler<Env>;

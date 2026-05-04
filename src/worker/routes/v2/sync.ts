// /v2 sync endpoints — wire-compatible with the original Go service so the
// PHP gateway can switch with no contract change.

import { Hono } from "hono";
import { apiSignature } from "../../lib/auth";
import { listAvailableShared, pickAccount } from "../../scheduling/pick";
import type { Provider } from "../../lib/types";

function parseIsMax(v: string | undefined): 0 | 1 | null {
	if (v == null || v === "") return null;
	const s = v.toLowerCase();
	if (s === "1" || s === "true") return 1;
	if (s === "0" || s === "false") return 0;
	return null;
}

function makeHandler(provider: Provider) {
	const app = new Hono<{ Bindings: Env }>();
	app.get("/", async (c) => {
		const kidStr = c.req.query("kid");
		const forceReplace = c.req.query("force_replace") === "true";
		const aid = c.req.query("aid");
		const isMax = parseIsMax(c.req.query("is_max"));

		if (!kidStr) {
			const list = await listAvailableShared(c.env.DB, provider, isMax);
			return c.json(list);
		}
		const kid = Number(kidStr);
		if (!Number.isFinite(kid)) {
			return c.json({ error: "Invalid kid parameter" }, 400);
		}
		const r = await pickAccount(c.env.DB, {
			provider,
			kid,
			forceReplace,
			problemAccountId: aid ? Number(aid) || undefined : undefined,
			isMax,
			env: c.env,
			ctx: c.executionCtx,
		});
		if (!r.ok) return c.json({ error: r.error, details: r.details }, r.status as 400 | 404 | 500);
		return c.json(r.response);
	});
	return app;
}

export const claudeSync = new Hono<{ Bindings: Env }>();
claudeSync.use("*", apiSignature("claude"));
claudeSync.route("/accounts-batch-q3n8r5", makeHandler("claude"));

export const gptSync = new Hono<{ Bindings: Env }>();
gptSync.use("*", apiSignature("gpt"));
gptSync.route("/accounts-batch-p5r2t8", makeHandler("gpt"));

export const geminiSync = new Hono<{ Bindings: Env }>();
geminiSync.use("*", apiSignature("gpt"));
geminiSync.route("/accounts-batch-x9k7n4", makeHandler("gemini"));

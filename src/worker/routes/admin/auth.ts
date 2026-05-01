import { Hono } from "hono";
import { clearSession, issueSession } from "../../lib/auth";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
	const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
	if (!c.env.ADMIN_SECRET) return c.json({ error: "ADMIN_SECRET not configured" }, 500);
	if (!body.password || body.password !== c.env.ADMIN_SECRET) {
		return c.json({ error: "invalid password" }, 401);
	}
	await issueSession(c, c.env.ADMIN_SECRET);
	return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
	clearSession(c);
	return c.json({ ok: true });
});

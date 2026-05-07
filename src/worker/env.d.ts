// Augments the auto-generated Env (worker-configuration.d.ts) with secrets
// that wrangler types cannot infer.

declare namespace Cloudflare {
	interface Env {
		ADMIN_SECRET: string;
		ES_URL: string;
		ES_USERNAME: string;
		ES_PASSWORD: string;
	}
}

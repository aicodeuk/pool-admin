// Outbound HTTP through an account's proxy.
// Cloudflare Workers fetch() does not support HTTP CONNECT proxies, so we
// route through a separate `proxy-egress` Worker (Service Binding).
//
// While that gateway is not yet deployed we fall back to direct fetch.
// Swap this implementation once env.PROXY is bound.

export interface ProxyConfig {
	host: string;
	port: number;
	username?: string | null;
	password?: string | null;
	scheme?: "http" | "socks5";
}

export function proxyConfigToUrl(p: ProxyConfig): string {
	const auth = p.username
		? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@`
		: "";
	return `${p.scheme ?? "http"}://${auth}${p.host}:${p.port}`;
}

export async function proxyFetch(
	env: Env,
	target: Request | string,
	proxy: ProxyConfig | null,
	init?: RequestInit,
): Promise<Response> {
	const proxyService = (env as unknown as { PROXY?: { fetch: typeof fetch } }).PROXY;
	if (proxyService && proxy) {
		const req = new Request(target, init);
		const headers = new Headers(req.headers);
		headers.set("X-Proxy-Url", proxyConfigToUrl(proxy));
		// ReadableStream bodies don't cross service-binding / Container boundaries
		// reliably — buffer to ArrayBuffer first.
		const body = req.body ? await req.arrayBuffer() : null;
		return proxyService.fetch(
			new Request(req.url, { method: req.method, headers, body }),
		);
	}
	// fallback: direct fetch (only safe for endpoints that do not require proxy)
	return fetch(target, init);
}

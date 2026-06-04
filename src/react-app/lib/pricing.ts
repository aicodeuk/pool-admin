// $/MTok official pricing — strip date suffix (e.g. -20251001) before matching
export interface Pricing { input: number; cacheWrite: number; cacheHit: number; output: number }

export interface ModelTokens {
	input_tokens: number;
	output_tokens: number;
	cache_creation_tokens: number;
	cache_read_tokens: number;
}

export function getModelPricing(raw: string): Pricing | null {
	const m = raw.toLowerCase().replace(/-\d{8}$/, "");
	if (m.includes("opus")) {
		if (m.match(/opus-4-[5678]/)) return { input: 5, cacheWrite: 6.25, cacheHit: 0.50, output: 25 };
		if (m.includes("opus-4-1") || m === "claude-opus-4") return { input: 15, cacheWrite: 18.75, cacheHit: 1.50, output: 75 };
		if (m.includes("opus-3")) return { input: 15, cacheWrite: 18.75, cacheHit: 1.50, output: 75 };
	}
	if (m.includes("sonnet")) return { input: 3, cacheWrite: 3.75, cacheHit: 0.30, output: 15 };
	if (m.includes("haiku")) {
		if (m.includes("haiku-4-5")) return { input: 1, cacheWrite: 1.25, cacheHit: 0.10, output: 5 };
		if (m.includes("haiku-3-5")) return { input: 0.80, cacheWrite: 1, cacheHit: 0.08, output: 4 };
		if (m.includes("haiku-3")) return { input: 0.25, cacheWrite: 0.30, cacheHit: 0.03, output: 1.25 };
	}
	return null;
}

export function calcCost(t: ModelTokens, p: Pricing): number {
	const M = 1_000_000;
	return (
		(t.input_tokens / M) * p.input +
		(t.cache_creation_tokens / M) * p.cacheWrite +
		(t.cache_read_tokens / M) * p.cacheHit +
		(t.output_tokens / M) * p.output
	);
}

export function fmtTokens(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
	if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
	return String(n);
}

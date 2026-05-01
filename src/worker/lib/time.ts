// All persisted time strings: 'YYYY-MM-DD HH:MM:SS' (UTC)
// Date-only fields (purchase_date, expire_date): 'YYYY-MM-DD'

export function nowDateTime(): string {
	return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function nowDate(): string {
	return new Date().toISOString().slice(0, 10);
}

export function addDays(base: string, days: number): string {
	// base may be date or datetime; output keeps the same shape
	const isDateOnly = base.length === 10;
	const d = new Date(isDateOnly ? `${base}T00:00:00Z` : `${base.replace(" ", "T")}Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return isDateOnly
		? d.toISOString().slice(0, 10)
		: d.toISOString().slice(0, 19).replace("T", " ");
}

export function fromUnixSeconds(sec: number): string {
	return new Date(sec * 1000).toISOString().slice(0, 19).replace("T", " ");
}

export function fromTimestampMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

export function isPast(dt: string | null | undefined): boolean {
	if (!dt) return false;
	const ts = Date.parse(dt.replace(" ", "T") + "Z");
	return Number.isFinite(ts) && ts < Date.now();
}

export function minutesUntil(dt: string | null | undefined): number | null {
	if (!dt) return null;
	const ts = Date.parse(dt.replace(" ", "T") + "Z");
	if (!Number.isFinite(ts)) return null;
	return Math.floor((ts - Date.now()) / 60000);
}

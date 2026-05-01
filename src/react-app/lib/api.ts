// Tiny fetch wrapper for the admin API.

export class ApiError extends Error {
	status: number;
	body: unknown;
	constructor(status: number, body: unknown) {
		super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
		this.status = status;
		this.body = body;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const r = await fetch(path, {
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
		...init,
	});
	const text = await r.text();
	const data = text ? JSON.parse(text) : null;
	if (!r.ok) throw new ApiError(r.status, data);
	return data as T;
}

export const api = {
	get: <T>(p: string) => request<T>(p),
	post: <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
	patch: <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
	put: <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
	delete: <T>(p: string) => request<T>(p, { method: "DELETE" }),
};

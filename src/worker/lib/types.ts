// Domain model row shapes (subset of columns we typically read).

export type Provider = "claude" | "gpt" | "gemini";
export type AccountStatus = "active" | "paused" | "problem" | "exhausted";
export type AccountTier = "free" | "pro" | "max";

export interface ProxyRow {
	id: number;
	name: string | null;
	host: string;
	port: number;
	username: string | null;
	password: string | null;
	scheme: "http" | "socks5";
	is_active: number;
	created_at: string;
	updated_at: string;
}

export interface AccountRow {
	id: number;
	provider: Provider;
	email: string | null;
	name: string | null;
	access_token: string | null;
	access_token_expires_at: string | null;
	refresh_token: string | null;
	refresh_token_expires_at: string | null;
	proxy_id: number | null;
	account_level: number;
	group_name: string | null;
	user_id: string | null;
	multiplier: number;
	tier: AccountTier;
	total_capacity: number;
	used_count: number;
	available_count: number;
	status: AccountStatus;
	status_reason: string | null;
	status_changed_at: string | null;
	retry_after: string | null;
	last_test_response: string | null;
	is_third_party: number;
	third_party_api_url: string | null;
	project: string | null;
	purchase_date: string | null;
	expire_date: string | null;
	usage_5h_pct: number | null;
	usage_5h_resets_at: string | null;
	usage_7d_pct: number | null;
	usage_7d_resets_at: string | null;
	usage_7d_sonnet_pct: number | null;
	usage_7d_sonnet_resets_at: string | null;
	usage_updated_at: string | null;
	usage_error: string | null;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface AccountResponse {
	id: number;
	access_token: string;
	has_claude_max: boolean;
	device: string;
	proxy: string;
	level: number;
	is_dedicated: boolean;
	project?: string;
	is_third_party: boolean;
	third_party_api_url?: string;
	user_id?: string;
	multiplier: number;
}

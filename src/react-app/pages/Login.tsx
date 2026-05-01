import { useState } from "react";
import { api } from "../lib/api";

interface Props {
	onSuccess: () => void;
}

export function Login({ onSuccess }: Props) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await api.post("/api/admin/login", { password });
			onSuccess();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="login">
			<form onSubmit={submit}>
				<h1>Pool Admin</h1>
				<div className="field">
					<label>管理员密码</label>
					<input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoFocus
					/>
				</div>
				<button type="submit" className="primary" style={{ width: "100%" }} disabled={loading}>
					{loading ? "登录中…" : "登录"}
				</button>
				{error && <div className="error">{error}</div>}
			</form>
		</div>
	);
}

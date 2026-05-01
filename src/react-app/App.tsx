import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Accounts } from "./pages/Accounts";
import { Proxies } from "./pages/Proxies";
import { KidGroups } from "./pages/KidGroups";
import { KidMappings } from "./pages/KidMappings";
import { Audit } from "./pages/Audit";
import { Onboard } from "./pages/Onboard";
import { Cron } from "./pages/Cron";
import { Docs } from "./pages/Docs";
import { ApiError, api } from "./lib/api";

function readHash(): string {
	const h = location.hash.replace(/^#/, "");
	return h || "dashboard";
}

function App() {
	const [authed, setAuthed] = useState<boolean | null>(null);
	const [page, setPage] = useState(readHash());

	useEffect(() => {
		api.get("/api/admin/me")
			.then(() => setAuthed(true))
			.catch((e) => {
				if (e instanceof ApiError && e.status === 401) setAuthed(false);
				else setAuthed(false);
			});
		const onHash = () => setPage(readHash());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	function navigate(id: string) {
		location.hash = id;
		setPage(id);
	}

	if (authed === null) return <div className="muted" style={{ padding: 32 }}>加载中…</div>;
	if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

	return (
		<Layout current={page} onNavigate={navigate} onLogout={() => setAuthed(false)}>
			{page === "dashboard" && <Dashboard />}
			{page === "accounts" && <Accounts />}
			{page === "proxies" && <Proxies />}
			{page === "kid-groups" && <KidGroups />}
			{page === "kid-mappings" && <KidMappings />}
			{page === "onboard" && <Onboard />}
			{page === "cron" && <Cron />}
			{page === "docs" && <Docs />}
			{page === "audit" && <Audit />}
		</Layout>
	);
}

export default App;

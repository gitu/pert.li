import type { Repo } from "@automerge/automerge-repo";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import { useContext, useEffect, useState } from "react";

export function RepoProvider({ children }: { children: React.ReactNode }) {
	const [repo, setRepo] = useState<Repo | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const { getBrowserRepo } = await import("./repo-client");
			const r = getBrowserRepo();
			if (!cancelled) setRepo(r);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>;
}

/**
 * Repo provider for the public /share/$token route. Connects to /sync with
 * the share token in the query string and exposes a token-scoped repo
 * (no IndexedDB persistence) via the same RepoContext as the authenticated
 * provider, so the project canvas components don't care which one mounted.
 */
export function ShareRepoProvider({
	token,
	children,
}: {
	token: string;
	children: React.ReactNode;
}) {
	const [repo, setRepo] = useState<Repo | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const { getShareRepo } = await import("./repo-client");
			const r = getShareRepo({ token });
			if (!cancelled) setRepo(r);
		})();
		return () => {
			cancelled = true;
		};
	}, [token]);

	return <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>;
}

/**
 * Returns the Automerge repo if it has finished initializing on the client,
 * otherwise `null`. Use instead of `useRepo()` when you need to render a
 * placeholder during SSR / first paint.
 */
export function useOptionalRepo(): Repo | null {
	return useContext(RepoContext);
}

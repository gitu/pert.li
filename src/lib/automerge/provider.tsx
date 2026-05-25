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
 * Returns the Automerge repo if it has finished initializing on the client,
 * otherwise `null`. Use instead of `useRepo()` when you need to render a
 * placeholder during SSR / first paint.
 */
export function useOptionalRepo(): Repo | null {
	return useContext(RepoContext);
}

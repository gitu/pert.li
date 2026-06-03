import type { Repo } from "@automerge/automerge-repo";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import { useContext, useEffect, useState } from "react";
import { CanvasLoading } from "#/components/canvas/canvas-loading";

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
	// Tag the resolved repo with the token it belongs to. Navigating between two
	// share links reuses this component instance (the route is keyed by path,
	// not param), so without the tag a stale `repo` from the previous token
	// would survive the `token` change until the effect re-ran — letting
	// descendants render for one frame against the wrong token's repo.
	const [resolved, setResolved] = useState<{
		token: string;
		repo: Repo;
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const { getShareRepo } = await import("./repo-client");
			const r = getShareRepo({ token });
			if (!cancelled) setResolved({ token, repo: r });
		})();
		return () => {
			cancelled = true;
		};
	}, [token]);

	// Only trust the resolved repo when it matches the current token; on a token
	// change `resolved` still holds the previous token's repo for one render.
	const repo = resolved?.token === token ? resolved.repo : null;

	// Hold the canvas back until the repo exists. The repo is created in the
	// effect above (async import), so it is `null` on first render. Unlike the
	// authenticated `RepoProvider` — mounted high in the app shell long before
	// any consumer — this provider mounts in the SAME render pass as its doc
	// consumer (`PertProjectPanel` → `useResilientDoc` → `useRepo()`), which
	// throws "Repo was not found on RepoContext" against a null context. View
	// shares hit this immediately (no NamePrompt gate to defer the consumer a
	// render), so they crashed where edit shares appeared to work. Gating here
	// protects every descendant `useRepo()` caller at once.
	if (!repo) {
		return <CanvasLoading message="Connecting…" />;
	}

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

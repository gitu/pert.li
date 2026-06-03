// @vitest-environment jsdom
import { Repo } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-react-hooks";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareRepoProvider } from "../provider";

// Token-scoped repos with no network/storage — enough for a consumer's
// `useRepo()` to resolve without opening sockets in the test environment. One
// per token, mirroring the real `getShareRepo`'s per-token instance map.
const repos = new Map<string, Repo>();
function repoForToken(token: string): Repo {
	let r = repos.get(token);
	if (!r) {
		r = new Repo({ network: [] });
		repos.set(token, r);
	}
	return r;
}

// The provider lazily `import("./repo-client")` to keep browser-only adapters
// out of the SSR bundle; stub it so the test doesn't spin up a real
// WebSocketClientAdapter against location.host. Keep the `{ token }` arg shape
// aligned with the real export.
vi.mock("../repo-client", () => ({
	getShareRepo: ({ token }: { token: string }) => repoForToken(token),
}));

afterEach(cleanup);

// A child that reads the repo the way every doc consumer does. `useRepo()`
// throws "Repo was not found on RepoContext" against a null context — the exact
// crash that broke view-only share links, where this consumer mounts in the
// same render pass as the provider (no NamePrompt to defer it a render).
function RepoConsumer() {
	const repo = useRepo();
	// peerId is unique per Repo instance, so it tells us *which* token's repo
	// the consumer mounted against.
	return <div data-testid="consumer">peer:{repo.peerId}</div>;
}

describe("ShareRepoProvider", () => {
	it("never renders a doc consumer against a null repo context", async () => {
		// Would throw synchronously during render if the provider exposed the
		// null first-render context to its children.
		expect(() =>
			render(
				<ShareRepoProvider token="tok-1">
					<RepoConsumer />
				</ShareRepoProvider>,
			),
		).not.toThrow();

		// First paint shows the holding state, not the consumer.
		expect(screen.queryByTestId("consumer")).toBeNull();

		// Once the async repo init resolves, the consumer mounts and reads it.
		await waitFor(() => {
			expect(screen.getByTestId("consumer")).toBeTruthy();
		});
	});

	it("re-gates and swaps repos when the token changes on the same instance", async () => {
		const { rerender } = render(
			<ShareRepoProvider token="tok-a">
				<RepoConsumer />
			</ShareRepoProvider>,
		);
		await waitFor(() => screen.getByTestId("consumer"));
		const peerA = screen.getByTestId("consumer").textContent;

		// Same component instance, new token: the consumer must never render
		// against tok-a's stale repo. It re-gates to the loading state, then
		// remounts against tok-b's repo.
		rerender(
			<ShareRepoProvider token="tok-b">
				<RepoConsumer />
			</ShareRepoProvider>,
		);
		expect(screen.queryByTestId("consumer")?.textContent ?? null).not.toBe(
			peerA,
		);

		await waitFor(() => {
			const peerB = screen.getByTestId("consumer").textContent;
			expect(peerB).toBeTruthy();
			expect(peerB).not.toBe(peerA);
		});
	});
});

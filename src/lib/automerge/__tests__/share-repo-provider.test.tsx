// @vitest-environment jsdom
import { Repo } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-react-hooks";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareRepoProvider } from "../provider";

// A token-scoped repo with no network/storage — enough for a consumer's
// `useRepo()` to resolve without opening sockets in the test environment.
const fakeRepo = new Repo({ network: [] });

// The provider lazily `import("./repo-client")` to keep browser-only adapters
// out of the SSR bundle; stub it so the test doesn't spin up a real
// WebSocketClientAdapter against location.host.
vi.mock("../repo-client", () => ({
	getShareRepo: () => fakeRepo,
}));

afterEach(cleanup);

// A child that reads the repo the way every doc consumer does. `useRepo()`
// throws "Repo was not found on RepoContext" against a null context — the exact
// crash that broke view-only share links, where this consumer mounts in the
// same render pass as the provider (no NamePrompt to defer it a render).
function RepoConsumer() {
	const repo = useRepo();
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
});

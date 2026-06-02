// @vitest-environment jsdom
import { type AnyDocumentId, Repo } from "@automerge/automerge-repo";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useResilientDoc } from "../use-resilient-doc";

afterEach(cleanup);

type TestDoc = { title: string };

// Renders the hook's outputs into the DOM so we can assert on them. The
// changeDoc/retry functions are stashed on a ref the tests can reach.
const lastApi: {
	changeDoc?: ReturnType<typeof useResilientDoc<TestDoc>>["changeDoc"];
	retry?: () => void;
} = {};

function Harness({ documentId }: { documentId: AnyDocumentId | undefined }) {
	const { doc, changeDoc, state, retry, handle } =
		useResilientDoc<TestDoc>(documentId);
	lastApi.changeDoc = changeDoc;
	lastApi.retry = retry;
	return (
		<div>
			<div data-testid="state">{state}</div>
			<div data-testid="title">{doc?.title ?? ""}</div>
			<div data-testid="has-handle">{handle ? "yes" : "no"}</div>
		</div>
	);
}

function renderWithRepo(repo: Repo, documentId: AnyDocumentId | undefined) {
	return render(
		<RepoContext.Provider value={repo}>
			<Harness documentId={documentId} />
		</RepoContext.Provider>,
	);
}

describe("useResilientDoc", () => {
	it("resolves a locally-created doc to ready and exposes its content", async () => {
		const repo = new Repo({ network: [] });
		const handle = repo.create<TestDoc>({ title: "hello" });
		renderWithRepo(repo, handle.url);
		await waitFor(() => {
			expect(screen.getByTestId("state").textContent).toBe("ready");
		});
		expect(screen.getByTestId("title").textContent).toBe("hello");
		expect(screen.getByTestId("has-handle").textContent).toBe("yes");
	});

	it("propagates doc changes made through the handle", async () => {
		const repo = new Repo({ network: [] });
		const handle = repo.create<TestDoc>({ title: "v1" });
		renderWithRepo(repo, handle.url);
		await waitFor(() => {
			expect(screen.getByTestId("state").textContent).toBe("ready");
		});
		act(() => {
			handle.change((d) => {
				d.title = "v2";
			});
		});
		await waitFor(() => {
			expect(screen.getByTestId("title").textContent).toBe("v2");
		});
	});

	it("changeDoc writes to the doc once ready", async () => {
		const repo = new Repo({ network: [] });
		const handle = repo.create<TestDoc>({ title: "before" });
		renderWithRepo(repo, handle.url);
		await waitFor(() => {
			expect(screen.getByTestId("state").textContent).toBe("ready");
		});
		act(() => {
			lastApi.changeDoc?.((d) => {
				d.title = "after";
			});
		});
		await waitFor(() => {
			expect(screen.getByTestId("title").textContent).toBe("after");
		});
		expect(handle.doc().title).toBe("after");
	});

	it("stays in loading state without a documentId", () => {
		const repo = new Repo({ network: [] });
		renderWithRepo(repo, undefined);
		expect(screen.getByTestId("state").textContent).toBe("loading");
		expect(screen.getByTestId("has-handle").textContent).toBe("no");
	});

	it("recovers when the same hook instance switches between documents", async () => {
		// The library hook poisons its module-level cache when a find gets
		// aborted by an id switch; this exercises the equivalent flow here.
		const repo = new Repo({ network: [] });
		const first = repo.create<TestDoc>({ title: "first" });
		const second = repo.create<TestDoc>({ title: "second" });

		const view = render(
			<RepoContext.Provider value={repo}>
				<Harness documentId={first.url} />
			</RepoContext.Provider>,
		);
		await waitFor(() => {
			expect(screen.getByTestId("title").textContent).toBe("first");
		});

		view.rerender(
			<RepoContext.Provider value={repo}>
				<Harness documentId={second.url} />
			</RepoContext.Provider>,
		);
		await waitFor(() => {
			expect(screen.getByTestId("title").textContent).toBe("second");
		});

		// And back again — the first doc must still load (this is where the
		// library hook gets stuck forever).
		view.rerender(
			<RepoContext.Provider value={repo}>
				<Harness documentId={first.url} />
			</RepoContext.Provider>,
		);
		await waitFor(() => {
			expect(screen.getByTestId("title").textContent).toBe("first");
		});
	});
});

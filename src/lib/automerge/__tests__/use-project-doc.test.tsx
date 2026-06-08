// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectDoc } from "#/lib/automerge/use-project-doc";
import {
	__resetPendingForTests,
	addPending,
	hydratePending,
} from "#/lib/sync/pending-projects";

// The detection lives in useProjectDoc: a locally-REGISTERED record whose
// server row is gone resolves to "deleted-remotely" (→ restore/delete prompt),
// but a transient/offline error must still open the project from the local doc.
// These cases pin that offline-safety boundary.

const getProjectById = vi.fn();
vi.mock("#/server/workspace.ts", () => ({
	getProjectById: (...args: unknown[]) => getProjectById(...args),
}));

const DOC_URL = "automerge:2j9knpQ8rXq6mC1Yh7Vd4Z3sT5n";

function wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return createElement(QueryClientProvider, { client: qc }, children);
}

async function seedRegistered() {
	await hydratePending();
	await addPending({
		localId: "loc-1",
		title: "Q3 launch plan",
		automergeDocUrl: DOC_URL as never,
		createdAt: "2026-01-01T00:00:00.000Z",
		status: "registered",
		serverId: "srv-1",
	});
}

beforeEach(() => {
	__resetPendingForTests();
	getProjectById.mockReset();
});

afterEach(() => {
	__resetPendingForTests();
});

it("flags deleted-remotely when the server says the row is gone", async () => {
	getProjectById.mockRejectedValue(new Error("Project not found"));
	await seedRegistered();

	const { result } = renderHook(() => useProjectDoc("srv-1"), { wrapper });

	await waitFor(() => expect(result.current.status).toBe("deleted-remotely"));
	if (result.current.status === "deleted-remotely") {
		expect(result.current.pending.localId).toBe("loc-1");
	}
});

it("stays ready (opens locally) on a network error — never prompts offline", async () => {
	getProjectById.mockRejectedValue(new Error("Failed to fetch"));
	await seedRegistered();

	const { result } = renderHook(() => useProjectDoc("srv-1"), { wrapper });

	// Give the query time to settle into its error state, then assert we did NOT
	// flip to deleted-remotely.
	await waitFor(() => expect(getProjectById).toHaveBeenCalled());
	await Promise.resolve();
	expect(result.current.status).toBe("ready");
});

it("stays ready when the server row still exists", async () => {
	getProjectById.mockResolvedValue({ automergeDocUrl: DOC_URL, title: "Q3" });
	await seedRegistered();

	const { result } = renderHook(() => useProjectDoc("srv-1"), { wrapper });

	await waitFor(() => expect(getProjectById).toHaveBeenCalled());
	expect(result.current.status).toBe("ready");
});

it("does NOT prompt for a not-yet-registered offline record", async () => {
	getProjectById.mockRejectedValue(new Error("Project not found"));
	await hydratePending();
	await addPending({
		localId: "loc-2",
		title: "Offline draft",
		automergeDocUrl: DOC_URL as never,
		createdAt: "2026-01-01T00:00:00.000Z",
		status: "pending",
	});

	const { result } = renderHook(() => useProjectDoc("loc-2"), { wrapper });

	// A pending (never-registered) record skips the server query entirely and
	// always opens locally.
	expect(result.current.status).toBe("ready");
	expect(getProjectById).not.toHaveBeenCalled();
});

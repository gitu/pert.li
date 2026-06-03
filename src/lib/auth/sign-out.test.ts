import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => {});
vi.mock("#/lib/auth-client", () => ({ authClient: { signOut } }));

const { signOutEverywhere } = await import("./sign-out");
const { clearCachedIdentity, readCachedIdentity, writeCachedIdentity } =
	await import("./offline-session");
const { __resetPendingForTests, addPending } = await import(
	"#/lib/sync/pending-projects"
);

const url = (s: string) => `automerge:${s}` as never;

beforeEach(() => {
	__resetPendingForTests();
	signOut.mockClear();
	clearCachedIdentity();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("signOutEverywhere", () => {
	it("signs out, clears the cached identity, and redirects when nothing is queued", async () => {
		writeCachedIdentity({ id: "u1", email: "ada@example.com" });
		const redirect = vi.fn();
		await signOutEverywhere({ redirect, confirm: () => true });
		expect(signOut).toHaveBeenCalledOnce();
		expect(readCachedIdentity()).toBeNull();
		expect(redirect).toHaveBeenCalledOnce();
	});

	it("does not prompt for confirmation when there's no unsynced work", async () => {
		await addPending({
			localId: "synced",
			title: "T",
			automergeDocUrl: url("synced"),
			createdAt: "2026-01-01T00:00:00.000Z",
			status: "registered",
			serverId: "s1",
		});
		const confirm = vi.fn(() => true);
		await signOutEverywhere({ redirect: vi.fn(), confirm });
		expect(confirm).not.toHaveBeenCalled();
		expect(signOut).toHaveBeenCalledOnce();
	});

	it("confirms before discarding unsynced projects and aborts if declined", async () => {
		await addPending({
			localId: "pending-1",
			title: "Unsynced",
			automergeDocUrl: url("pending-1"),
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const confirm = vi.fn(() => false);
		const redirect = vi.fn();
		await signOutEverywhere({ confirm, redirect });
		expect(confirm).toHaveBeenCalledOnce();
		// Declined → nothing is torn down.
		expect(signOut).not.toHaveBeenCalled();
		expect(redirect).not.toHaveBeenCalled();
	});

	it("proceeds through sign-out when the unsynced-work prompt is accepted", async () => {
		await addPending({
			localId: "pending-2",
			title: "Unsynced",
			automergeDocUrl: url("pending-2"),
			createdAt: "2026-01-01T00:00:00.000Z",
			status: "error",
		});
		const redirect = vi.fn();
		await signOutEverywhere({ confirm: () => true, redirect });
		expect(signOut).toHaveBeenCalledOnce();
		expect(redirect).toHaveBeenCalledOnce();
	});
});

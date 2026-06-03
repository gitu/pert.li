import type { AutomergeUrl } from "@automerge/automerge-repo";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetPendingForTests,
	addPending,
	getPending,
	getPendingSnapshot,
} from "./pending-projects";
import {
	nextWakeAt,
	processRecord,
	type ReconcileDeps,
	reconcileOnce,
	retryNow,
} from "./reconcile-pending";
import { MAX_ATTEMPTS } from "./retry";

const url = (s: string) => `automerge:${s}` as AutomergeUrl;

function summary(id: string, workspaceId = "ws-1") {
	return {
		id,
		workspaceId,
		title: "P",
		description: null,
		automergeDocUrl: url(id),
		createdAt: "2026-01-01T00:00:00.000Z",
		createdBy: "u1",
		parentProjectId: null,
		branchedFromHeads: null,
		branchedAt: null,
		archivedAt: null,
	};
}

function baseDeps(over: Partial<ReconcileDeps> = {}): ReconcileDeps {
	return {
		register: vi.fn(async () => ({
			project: summary("server-1"),
			alreadyRegistered: false,
		})),
		hasLiveSession: () => true,
		now: () => 1_000_000,
		rng: () => 0.5,
		...over,
	};
}

async function seed(localId = "local-1") {
	return addPending({
		localId,
		title: "Plan",
		automergeDocUrl: url(localId),
		createdAt: "2026-01-01T00:00:00.000Z",
	});
}

beforeEach(() => {
	__resetPendingForTests();
});

describe("processRecord", () => {
	it("registers a pending record and stores the server id + workspace", async () => {
		const rec = await seed();
		const onRegistered = vi.fn();
		const nudgeSync = vi.fn();
		const result = await processRecord(
			rec,
			baseDeps({ onRegistered, nudgeSync }),
		);
		expect(result.status).toBe("registered");
		expect(result.serverId).toBe("server-1");
		expect(result.workspaceId).toBe("ws-1");
		expect(onRegistered).toHaveBeenCalledOnce();
		expect(nudgeSync).toHaveBeenCalledWith(url("local-1"));
	});

	it("treats a 401 as auth-pause: stays pending, no attempt burned, no backoff", async () => {
		const rec = await seed();
		const result = await processRecord(
			rec,
			baseDeps({
				register: vi.fn(async () => {
					throw Object.assign(new Error("unauthorized"), { status: 401 });
				}),
			}),
		);
		expect(result.status).toBe("pending");
		expect(result.attempts).toBe(0);
		expect(result.lastErrorKind).toBe("auth");
		expect(result.nextRetryAt).toBeUndefined();
	});

	it("parks a 403 in the manual-only error state", async () => {
		const rec = await seed();
		const result = await processRecord(
			rec,
			baseDeps({
				register: vi.fn(async () => {
					throw Object.assign(new Error("Write access required"), {
						status: 403,
					});
				}),
			}),
		);
		expect(result.status).toBe("error");
		expect(result.lastErrorKind).toBe("terminal");
		expect(result.nextRetryAt).toBeUndefined();
	});

	it("schedules backoff on a transient failure", async () => {
		const rec = await seed();
		const result = await processRecord(
			rec,
			baseDeps({
				now: () => 1_000_000,
				rng: () => 1, // upper bound of the jitter window
				register: vi.fn(async () => {
					throw new Error("Failed to fetch");
				}),
			}),
		);
		expect(result.status).toBe("pending");
		expect(result.attempts).toBe(1);
		expect(result.lastErrorKind).toBe("transient");
		// attempts=1 → base*2^1 = 2000ms window, rng=1 → exactly 2000ms ahead.
		expect(result.nextRetryAt).toBe(1_000_000 + 2000);
	});

	it("gives up (→ error) after MAX_ATTEMPTS transient failures", async () => {
		const rec = await addPending({
			localId: "l",
			title: "P",
			automergeDocUrl: url("l"),
			createdAt: "2026-01-01T00:00:00.000Z",
			attempts: MAX_ATTEMPTS - 1,
		});
		const result = await processRecord(
			rec,
			baseDeps({
				register: vi.fn(async () => {
					throw new Error("Failed to fetch");
				}),
			}),
		);
		expect(result.status).toBe("error");
		expect(result.attempts).toBe(MAX_ATTEMPTS);
		expect(result.nextRetryAt).toBeUndefined();
	});

	it("skips a record still inside its backoff window", async () => {
		const rec = await addPending({
			localId: "l",
			title: "P",
			automergeDocUrl: url("l"),
			createdAt: "2026-01-01T00:00:00.000Z",
			nextRetryAt: 2_000_000,
		});
		const register = vi.fn();
		await processRecord(rec, baseDeps({ now: () => 1_000_000, register }));
		expect(register).not.toHaveBeenCalled();
	});
});

describe("reconcileOnce", () => {
	it("does nothing without a live session", async () => {
		await seed();
		const register = vi.fn();
		const count = await reconcileOnce(
			baseDeps({ hasLiveSession: () => false, register }),
		);
		expect(count).toBe(0);
		expect(register).not.toHaveBeenCalled();
	});

	it("registers all eligible records and skips errored ones", async () => {
		await seed("a");
		await seed("b");
		const errored = await seed("c");
		// Force c into a terminal error so the drain leaves it alone.
		await processRecord(
			errored,
			baseDeps({
				register: vi.fn(async () => {
					throw Object.assign(new Error("forbidden"), { status: 403 });
				}),
			}),
		);
		let n = 0;
		const count = await reconcileOnce(
			baseDeps({
				register: vi.fn(async () => {
					n++;
					return { project: summary(`s${n}`), alreadyRegistered: false };
				}),
			}),
		);
		expect(count).toBe(2);
		expect(getPending("a")?.status).toBe("registered");
		expect(getPending("b")?.status).toBe("registered");
		expect(getPending("c")?.status).toBe("error");
	});
});

describe("processRecord — conflict / idempotent re-register", () => {
	it("converges to the existing server row when register reports alreadyRegistered", async () => {
		const rec = await seed();
		const result = await processRecord(
			rec,
			baseDeps({
				register: vi.fn(async () => ({
					project: summary("existing-srv"),
					alreadyRegistered: true,
				})),
			}),
		);
		expect(result.status).toBe("registered");
		expect(result.serverId).toBe("existing-srv");
	});
});

describe("nextWakeAt", () => {
	it("returns null when nothing is pending", async () => {
		await addPending({
			localId: "done",
			title: "P",
			automergeDocUrl: url("done"),
			createdAt: "2026-01-01T00:00:00.000Z",
			status: "registered",
		});
		expect(nextWakeAt(1_000_000)).toBeNull();
	});

	it("returns the earliest scheduled retry across pending records", async () => {
		await addPending({
			localId: "a",
			title: "P",
			automergeDocUrl: url("a"),
			createdAt: "2026-01-01T00:00:00.000Z",
			nextRetryAt: 5_000,
		});
		await addPending({
			localId: "b",
			title: "P",
			automergeDocUrl: url("b"),
			createdAt: "2026-01-01T00:00:00.000Z",
			nextRetryAt: 2_000,
		});
		expect(nextWakeAt(1_000)).toBe(2_000);
	});

	it("treats a pending record with no backoff as eligible immediately (now)", async () => {
		await addPending({
			localId: "c",
			title: "P",
			automergeDocUrl: url("c"),
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(nextWakeAt(1_234)).toBe(1_234);
	});
});

describe("retryNow", () => {
	it("clears the error state and re-attempts immediately", async () => {
		const rec = await seed();
		// First push it to error via terminal failure.
		await processRecord(
			rec,
			baseDeps({
				register: vi.fn(async () => {
					throw Object.assign(new Error("forbidden"), { status: 403 });
				}),
			}),
		);
		expect(getPending("local-1")?.status).toBe("error");
		// Now retry with a register that succeeds.
		const result = await retryNow("local-1", baseDeps());
		expect(result?.status).toBe("registered");
		expect(
			getPendingSnapshot().find((r) => r.localId === "local-1")?.status,
		).toBe("registered");
	});
});

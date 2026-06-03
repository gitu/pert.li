import type { AutomergeUrl } from "@automerge/automerge-repo";
import { beforeEach, describe, expect, it } from "vitest";
import {
	__resetPendingForTests,
	addPending,
	clearPending,
	findPendingByProjectId,
	getPending,
	getPendingSnapshot,
	removePending,
	subscribePending,
	updatePending,
} from "./pending-projects";

const url = (s: string) => `automerge:${s}` as AutomergeUrl;

function seed(localId: string, createdAt: string, title = "p") {
	return addPending({
		localId,
		title,
		automergeDocUrl: url(localId),
		createdAt,
	});
}

beforeEach(() => {
	__resetPendingForTests();
});

describe("pending-projects store", () => {
	it("adds with default status/attempts and reads back", async () => {
		const rec = await seed("a", "2026-01-01T00:00:00.000Z");
		expect(rec.status).toBe("pending");
		expect(rec.attempts).toBe(0);
		expect(getPending("a")?.title).toBe("p");
	});

	it("keeps the snapshot sorted by createdAt and stable between reads", async () => {
		await seed("b", "2026-01-02T00:00:00.000Z");
		await seed("a", "2026-01-01T00:00:00.000Z");
		const snap = getPendingSnapshot();
		expect(snap.map((r) => r.localId)).toEqual(["a", "b"]);
		// Same reference until a mutation occurs (useSyncExternalStore contract).
		expect(getPendingSnapshot()).toBe(snap);
	});

	it("notifies subscribers on mutation", async () => {
		let calls = 0;
		const unsub = subscribePending(() => {
			calls++;
		});
		await seed("a", "2026-01-01T00:00:00.000Z");
		await updatePending("a", { status: "registered" });
		await removePending("a");
		unsub();
		expect(calls).toBe(3);
	});

	it("patches a record and bumps attempts", async () => {
		await seed("a", "2026-01-01T00:00:00.000Z");
		const next = await updatePending("a", {
			attempts: 2,
			status: "error",
			lastError: "boom",
		});
		expect(next?.attempts).toBe(2);
		expect(next?.status).toBe("error");
		expect(getPending("a")?.lastError).toBe("boom");
	});

	it("resolves by serverId after registration", async () => {
		await seed("local-1", "2026-01-01T00:00:00.000Z");
		await updatePending("local-1", {
			status: "registered",
			serverId: "server-9",
		});
		expect(findPendingByProjectId("local-1")?.localId).toBe("local-1");
		expect(findPendingByProjectId("server-9")?.localId).toBe("local-1");
		expect(findPendingByProjectId("nope")).toBeUndefined();
	});

	it("clearPending empties the whole queue and notifies once", async () => {
		await seed("a", "2026-01-01T00:00:00.000Z");
		await seed("b", "2026-01-02T00:00:00.000Z");
		let calls = 0;
		const unsub = subscribePending(() => {
			calls++;
		});
		await clearPending();
		unsub();
		expect(getPendingSnapshot()).toEqual([]);
		expect(getPending("a")).toBeUndefined();
		expect(calls).toBe(1);
	});

	it("update/remove on a missing id is a no-op", async () => {
		expect(await updatePending("ghost", { attempts: 1 })).toBeUndefined();
		await expect(removePending("ghost")).resolves.toBeUndefined();
	});
});

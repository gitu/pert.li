import * as Automerge from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import { actorColor, shortActor } from "#/lib/pert/actor-format";
import {
	coalesceEntries,
	type HistoryEntry,
	readHistory,
	snapshotAt,
} from "#/lib/pert/history";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";

function entry(
	overrides: Partial<HistoryEntry> & { index: number; heads: string[] },
): HistoryEntry {
	return {
		actor: "actor1",
		time: null,
		message: null,
		...overrides,
	};
}

describe("readHistory", () => {
	it("captures one entry per Automerge.change call", () => {
		let doc = Automerge.from<PertDoc>(createEmptyPertDoc("h"));
		doc = Automerge.change(doc, (d) => {
			d.tasksById.A = {
				id: "A",
				kind: "task",
				title: "A",
				parentId: null,
			};
		});
		doc = Automerge.change(doc, "rename A", (d) => {
			d.tasksById.A.title = "Alpha";
		});
		const entries = readHistory(doc);
		// initial-load change + the two above. We don't assume exactly 3 (the
		// internal init may be folded into the first change). At minimum
		// readHistory captures both user edits.
		expect(entries.length).toBeGreaterThanOrEqual(2);
		expect(entries.at(-1)?.message).toBe("rename A");
	});
});

describe("coalesceEntries", () => {
	it("groups adjacent entries from the same actor in the window", () => {
		const groups = coalesceEntries(
			[
				entry({ index: 0, heads: ["h0"], time: 1_000 }),
				entry({ index: 1, heads: ["h1"], time: 2_000 }),
				entry({ index: 2, heads: ["h2"], time: 3_000 }),
			],
			30_000,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toEqual(
			expect.objectContaining({
				heads: ["h2"],
				count: 3,
				startTime: 1_000,
				endTime: 3_000,
				firstIndex: 0,
				lastIndex: 2,
			}),
		);
	});

	it("starts a new group when actor changes", () => {
		const groups = coalesceEntries(
			[
				entry({ index: 0, heads: ["h0"], actor: "a1", time: 1_000 }),
				entry({ index: 1, heads: ["h1"], actor: "a2", time: 2_000 }),
			],
			30_000,
		);
		expect(groups).toHaveLength(2);
		expect(groups.map((g) => g.actor)).toEqual(["a1", "a2"]);
	});

	it("starts a new group when gap exceeds window", () => {
		const groups = coalesceEntries(
			[
				entry({ index: 0, heads: ["h0"], time: 1_000 }),
				entry({ index: 1, heads: ["h1"], time: 60_000 }),
			],
			30_000,
		);
		expect(groups).toHaveLength(2);
	});

	it("folds entries with null timestamps onto the previous group", () => {
		const groups = coalesceEntries(
			[
				entry({ index: 0, heads: ["h0"], time: 1_000 }),
				entry({ index: 1, heads: ["h1"], time: null }),
				entry({ index: 2, heads: ["h2"], time: 2_000 }),
			],
			30_000,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(3);
	});

	it("treats different messages as boundaries", () => {
		const groups = coalesceEntries(
			[
				entry({ index: 0, heads: ["h0"], time: 1_000, message: "edit a" }),
				entry({ index: 1, heads: ["h1"], time: 2_000, message: "edit b" }),
			],
			30_000,
		);
		expect(groups).toHaveLength(2);
	});

	it("returns an empty list on empty input", () => {
		expect(coalesceEntries([])).toEqual([]);
	});
});

describe("shortActor / actorColor", () => {
	it("shortens to 4 chars", () => {
		expect(shortActor("abcdef1234567890")).toBe("abcd");
	});

	it("is deterministic and produces a real hue", () => {
		const c1 = actorColor("actor-aaa");
		const c2 = actorColor("actor-aaa");
		const c3 = actorColor("actor-bbb");
		expect(c1).toBe(c2);
		expect(c1).not.toBe(c3);
		expect(c1).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
	});
});

describe("snapshotAt", () => {
	it("returns the same doc when heads match current", () => {
		let doc = Automerge.from<PertDoc>(createEmptyPertDoc("snap"));
		doc = Automerge.change(doc, (d) => {
			d.title = "Updated";
		});
		const current = Automerge.getHeads(doc);
		const snap = snapshotAt(doc, current);
		expect(snap).toBe(doc);
	});

	it("returns a frozen view at older heads", () => {
		let doc = Automerge.from<PertDoc>(createEmptyPertDoc("v0"));
		const initialHeads = Automerge.getHeads(doc);
		doc = Automerge.change(doc, (d) => {
			d.title = "v1";
		});
		const snap = snapshotAt(doc, initialHeads);
		expect(snap.title).toBe("v0");
		expect(doc.title).toBe("v1");
	});
});

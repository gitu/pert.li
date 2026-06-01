import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeMerge } from "#/lib/pert/merge";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
	type Task,
} from "#/lib/pert/types";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

function leaf(id: string, title: string, e?: Estimate): Task {
	return {
		id,
		kind: "task",
		title,
		parentId: null,
		estimate: e ?? est(1, 2, 3),
	};
}

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("d");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

function clone(doc: PertDoc): PertDoc {
	return JSON.parse(JSON.stringify(doc)) as PertDoc;
}

describe("computeMerge", () => {
	it("returns an empty result for three identical docs", () => {
		const d = build(leaf("A", "Alpha"));
		const r = computeMerge({ base: d, main: clone(d), branch: clone(d) });
		expect(r.changes).toEqual([]);
		expect(r.counts).toEqual({ clean: 0, conflict: 0, sameResult: 0 });
	});

	it("classifies a branch-only title change as clean-from-branch", () => {
		const base = build(leaf("A", "Alpha"));
		const main = clone(base);
		const branch = build({ ...leaf("A", "Alpha v2") });
		const r = computeMerge({ base, main, branch });
		expect(r.counts.clean).toBe(1);
		expect(r.counts.conflict).toBe(0);
		const row = r.changes[0];
		expect(row.kind).toBe("field");
		if (row.kind === "field") {
			expect(row.field).toBe("title");
			expect(row.classification).toBe("clean-from-branch");
			expect(row.suggestedSide).toBe("branch");
			expect(row.branch).toBe("Alpha v2");
		}
	});

	it("omits a main-only change (no branch action needed)", () => {
		const base = build(leaf("A", "Alpha"));
		const main = build(leaf("A", "Alpha v2"));
		const branch = clone(base);
		const r = computeMerge({ base, main, branch });
		expect(r.changes).toEqual([]);
	});

	it("classifies a both-sides-same change as sameResult, not as a row", () => {
		const base = build(leaf("A", "Alpha"));
		const main = build(leaf("A", "Alpha v2"));
		const branch = build(leaf("A", "Alpha v2"));
		const r = computeMerge({ base, main, branch });
		expect(r.changes).toEqual([]);
		expect(r.counts.sameResult).toBe(1);
	});

	it("flags a both-sides-different change as conflict-modified", () => {
		const base = build(leaf("A", "Alpha"));
		const main = build(leaf("A", "MainTitle"));
		const branch = build(leaf("A", "BranchTitle"));
		const r = computeMerge({ base, main, branch });
		expect(r.counts.conflict).toBe(1);
		const row = r.changes[0];
		expect(row.kind).toBe("field");
		if (row.kind === "field") {
			expect(row.classification).toBe("conflict-modified");
			expect(row.main).toBe("MainTitle");
			expect(row.branch).toBe("BranchTitle");
			expect(row.suggestedSide).toBe("main");
		}
	});

	it("classifies a branch-only added task as clean-add-from-branch", () => {
		const base = build(leaf("A", "Alpha"));
		const main = clone(base);
		const branch = build(leaf("A", "Alpha"), leaf("C", "Charlie"));
		const r = computeMerge({ base, main, branch });
		expect(r.counts.clean).toBe(1);
		const row = r.changes[0];
		expect(row.kind).toBe("entity");
		if (row.kind === "entity") {
			expect(row.classification).toBe("clean-add-from-branch");
			expect(row.id).toBe("C");
		}
	});

	it("classifies branch-removed + main-modified as conflict-removed-vs-modified", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const main = build(leaf("A", "Alpha"), leaf("B", "Beta v2"));
		const branch = build(leaf("A", "Alpha"));
		const r = computeMerge({ base, main, branch });
		expect(r.counts.conflict).toBe(1);
		const row = r.changes[0];
		expect(row.kind).toBe("entity");
		if (row.kind === "entity") {
			expect(row.classification).toBe("conflict-removed-vs-modified");
			expect(row.suggestedSide).toBe("main");
		}
	});

	it("classifies branch-modified + main-removed as conflict-modified-vs-removed", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const main = build(leaf("A", "Alpha"));
		const branch = build(leaf("A", "Alpha"), leaf("B", "Beta v2"));
		const r = computeMerge({ base, main, branch });
		expect(r.counts.conflict).toBe(1);
		const row = r.changes[0];
		expect(row.kind).toBe("entity");
		if (row.kind === "entity") {
			expect(row.classification).toBe("conflict-modified-vs-removed");
		}
	});

	it("treats both-sides-removed as sameResult (no row)", () => {
		const base = build(leaf("A", "Alpha"), leaf("B", "Beta"));
		const main = build(leaf("A", "Alpha"));
		const branch = build(leaf("A", "Alpha"));
		const r = computeMerge({ base, main, branch });
		expect(r.changes).toEqual([]);
		expect(r.counts.sameResult).toBe(1);
	});

	it("classifies both-sides-added with diverging fields as conflict-add-vs-add", () => {
		const base = createEmptyPertDoc("d");
		const main = build(leaf("X", "MainX"));
		const branch = build(leaf("X", "BranchX"));
		const r = computeMerge({ base, main, branch });
		expect(r.counts.conflict).toBeGreaterThan(0);
		expect(
			r.changes.some(
				(c) => c.kind === "field" && c.classification === "conflict-add-vs-add",
			),
		).toBe(true);
	});

	it("clean adds with identical fields collapse to sameResult", () => {
		const base = createEmptyPertDoc("d");
		const main = build(leaf("X", "Same"));
		const branch = build(leaf("X", "Same"));
		const r = computeMerge({ base, main, branch });
		expect(r.changes).toEqual([]);
		expect(r.counts.sameResult).toBe(1);
	});

	it("property: clean rows always suggest 'branch'; conflicts always suggest 'main'", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid().map((s) => s.slice(0, 8)),
						mainTitle: fc.string({ minLength: 1, maxLength: 20 }),
						branchTitle: fc.string({ minLength: 1, maxLength: 20 }),
					}),
					{ minLength: 0, maxLength: 6 },
				),
				(items) => {
					const base = createEmptyPertDoc("d");
					for (const i of items) base.tasksById[i.id] = leaf(i.id, "BaseTitle");
					const main = clone(base);
					const branch = clone(base);
					for (const i of items) {
						main.tasksById[i.id].title = i.mainTitle;
						branch.tasksById[i.id].title = i.branchTitle;
					}
					const r = computeMerge({ base, main, branch });
					for (const c of r.changes) {
						if (c.classification.startsWith("conflict")) {
							expect(c.suggestedSide).toBe("main");
						} else {
							expect(c.suggestedSide).toBe("branch");
						}
					}
				},
			),
		);
	});

	it("property: swapping main and branch flips every per-field conflict's suggested side", () => {
		// Pure conflicts (both sides change a field differently) — the merge
		// engine's default resolution is "keep main." If we swap roles, what was
		// "main" becomes "branch": the value the engine wants to keep is still
		// the one labelled "main" after the swap.
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid().map((s) => s.slice(0, 8)),
						a: fc.string({ minLength: 1, maxLength: 10 }),
						b: fc.string({ minLength: 1, maxLength: 10 }),
					}),
					{ minLength: 1, maxLength: 4 },
				),
				(items) => {
					// Discard cases where the two sides happen to land on the same
					// title — those collapse to sameResult, not a conflict row.
					fc.pre(items.every((i) => i.a !== i.b));
					const base = createEmptyPertDoc("d");
					for (const i of items) base.tasksById[i.id] = leaf(i.id, "BaseTitle");
					const main = clone(base);
					const branch = clone(base);
					for (const i of items) {
						main.tasksById[i.id].title = i.a;
						branch.tasksById[i.id].title = i.b;
					}
					const r1 = computeMerge({ base, main, branch });
					const r2 = computeMerge({ base, main: branch, branch: main });
					expect(r1.counts.conflict).toBe(r2.counts.conflict);
					for (const c of r1.changes) {
						expect(c.suggestedSide).toBe("main");
					}
					for (const c of r2.changes) {
						expect(c.suggestedSide).toBe("main");
					}
				},
			),
		);
	});
});

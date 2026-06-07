import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	effectiveGroupForTask,
	filterCollapsedToRendered,
	getChildGroups,
	getGroupAncestors,
	getGroupDescendants,
	getNearestCollapsedAncestorGroup,
	getNearestCollapsedGroup,
	getRootGroups,
	getTasksInGroup,
	getTasksInGroupDeep,
	groupLevel,
	isGroupRendered,
	isGroupWithin,
} from "../hierarchy";
import type { Group, PertDoc, Task } from "../types";
import { createEmptyPertDoc } from "../types";

function group(
	id: string,
	parentGroupId: string | null = null,
	order = 0,
): Group {
	return { id, name: id, parentGroupId, order };
}

function task(id: string, groupId: string | null = null, order = 0): Task {
	return { id, kind: "task", title: id, groupId, order };
}

function build(groups: Group[], tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("h");
	for (const g of groups) doc.groupsById[g.id] = g;
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

describe("group-tree helpers", () => {
	// root ─┬─ b (order 0)
	//       └─ a (order 1) ─┬─ leaf1
	//                       └─ leaf2
	// root's direct member: childTask. orphan is ungrouped.
	const doc = build(
		[group("root", null, 0), group("a", "root", 1), group("b", "root", 0)],
		[
			task("childTask", "root", 0),
			task("leaf1", "a", 0),
			task("leaf2", "a", 1),
			task("orphan", null, 0),
		],
	);

	it("getChildGroups returns direct child groups sorted by (order, id)", () => {
		expect(getChildGroups(doc, "root").map((g) => g.id)).toEqual(["b", "a"]);
		expect(getChildGroups(doc, "a")).toEqual([]);
	});

	it("getRootGroups returns top-level groups", () => {
		expect(getRootGroups(doc).map((g) => g.id)).toEqual(["root"]);
	});

	it("getGroupAncestors walks parentGroupId upward", () => {
		expect(getGroupAncestors(doc, "a")).toEqual(["root"]);
		expect(getGroupAncestors(doc, "root")).toEqual([]);
		expect(getGroupAncestors(doc, "missing")).toEqual([]);
	});

	it("getGroupAncestors stops at a parent cycle instead of looping", () => {
		const looped = build([group("X", "Y"), group("Y", "X")], []);
		expect(getGroupAncestors(looped, "X").length).toBeLessThanOrEqual(2);
	});

	it("getGroupDescendants gathers the whole subtree of groups", () => {
		expect(getGroupDescendants(doc, "root").sort()).toEqual(["a", "b"]);
		expect(getGroupDescendants(doc, "a")).toEqual([]);
	});

	it("getTasksInGroup returns direct member tasks sorted by (order, id)", () => {
		expect(getTasksInGroup(doc, "a").map((t) => t.id)).toEqual([
			"leaf1",
			"leaf2",
		]);
		expect(getTasksInGroup(doc, "root").map((t) => t.id)).toEqual([
			"childTask",
		]);
	});

	it("getTasksInGroupDeep includes tasks of descendant groups", () => {
		expect(
			getTasksInGroupDeep(doc, "root")
				.map((t) => t.id)
				.sort(),
		).toEqual(["childTask", "leaf1", "leaf2"]);
		expect(
			getTasksInGroupDeep(doc, "a")
				.map((t) => t.id)
				.sort(),
		).toEqual(["leaf1", "leaf2"]);
	});

	it("isGroupWithin checks group containment", () => {
		expect(isGroupWithin(doc, "a", "root")).toBe(true);
		expect(isGroupWithin(doc, "root", "root")).toBe(true);
		expect(isGroupWithin(doc, "b", "a")).toBe(false);
		expect(isGroupWithin(doc, "root", "a")).toBe(false);
	});

	it("getNearestCollapsedAncestorGroup returns the closest collapsed wrapper", () => {
		const collapsedRoot = new Set(["root"]);
		expect(getNearestCollapsedAncestorGroup(doc, "a", collapsedRoot)).toBe(
			"root",
		);
		expect(getNearestCollapsedAncestorGroup(doc, "root", collapsedRoot)).toBe(
			"root",
		);

		const collapsedA = new Set(["a"]);
		expect(getNearestCollapsedAncestorGroup(doc, "a", collapsedA)).toBe("a");
		expect(getNearestCollapsedAncestorGroup(doc, "b", collapsedA)).toBe(null);
	});

	it("getNearestCollapsedGroup resolves the collapsed group a task lives in", () => {
		const collapsedRoot = new Set(["root"]);
		expect(getNearestCollapsedGroup(doc, "leaf1", collapsedRoot)).toBe("root");
		expect(getNearestCollapsedGroup(doc, "childTask", collapsedRoot)).toBe(
			"root",
		);
		expect(getNearestCollapsedGroup(doc, "orphan", collapsedRoot)).toBe(null);

		const collapsedA = new Set(["a"]);
		expect(getNearestCollapsedGroup(doc, "leaf1", collapsedA)).toBe("a");
		expect(getNearestCollapsedGroup(doc, "childTask", collapsedA)).toBe(null);
	});
});

// Generates a valid group forest: each group is parented under one of lower
// index (or root), guaranteeing acyclic parentGroupId chains.
function arbDoc(maxGroups = 12): fc.Arbitrary<PertDoc> {
	return fc.integer({ min: 1, max: maxGroups }).chain((n) =>
		fc
			.array(fc.integer({ min: -1, max: maxGroups - 1 }), {
				minLength: n,
				maxLength: n,
			})
			.map((parents) => {
				const doc = createEmptyPertDoc("rand");
				for (let i = 0; i < n; i++) {
					const parentIdx = parents[i];
					const parentGroupId =
						parentIdx >= 0 && parentIdx < i ? `G${parentIdx}` : null;
					doc.groupsById[`G${i}`] = {
						id: `G${i}`,
						name: `G${i}`,
						parentGroupId,
						order: i,
					};
				}
				return doc;
			}),
	);
}

describe("group-tree property tests", () => {
	it("ancestors and descendants are dual: A in ancestors(B) iff B in descendants(A)", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				const ids = Object.keys(doc.groupsById);
				for (const a of ids) {
					const desc = new Set(getGroupDescendants(doc, a));
					for (const b of ids) {
						if (b === a) continue;
						const ancestors = new Set(getGroupAncestors(doc, b));
						if (desc.has(b) !== ancestors.has(a)) return false;
					}
				}
				return true;
			}),
			{ numRuns: 50 },
		);
	});

	it("isGroupWithin is the transitive closure of getChildGroups", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				for (const id of Object.keys(doc.groupsById)) {
					for (const desc of getGroupDescendants(doc, id)) {
						if (!isGroupWithin(doc, desc, id)) return false;
					}
				}
				return true;
			}),
			{ numRuns: 50 },
		);
	});

	it("root groups have no ancestors", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				for (const root of getRootGroups(doc)) {
					if (getGroupAncestors(doc, root.id).length !== 0) return false;
				}
				return true;
			}),
			{ numRuns: 50 },
		);
	});
});

describe("grouping-level helpers", () => {
	// L1 > L2 > L3 chain plus a sibling at L1.
	const doc = build(
		[group("L1"), group("L2", "L1"), group("L3", "L2"), group("other")],
		[task("rootTask"), task("a", "L1"), task("b", "L2"), task("c", "L3")],
	);

	it("groupLevel is 1-based by depth", () => {
		expect(groupLevel(doc, "L1")).toBe(1);
		expect(groupLevel(doc, "L2")).toBe(2);
		expect(groupLevel(doc, "L3")).toBe(3);
		expect(groupLevel(doc, "other")).toBe(1);
	});

	it("isGroupRendered respects the cap (0 = off renders nothing)", () => {
		expect(isGroupRendered(doc, "L3", 2)).toBe(false);
		expect(isGroupRendered(doc, "L2", 2)).toBe(true);
		expect(isGroupRendered(doc, "L1", 2)).toBe(true);
		expect(isGroupRendered(doc, "L1", 0)).toBe(false);
		expect(isGroupRendered(doc, "L3", Number.POSITIVE_INFINITY)).toBe(true);
	});

	it("effectiveGroupForTask folds deep tasks into the nearest shown ancestor", () => {
		// Uncapped: each task keeps its own group.
		expect(effectiveGroupForTask(doc, "c", Number.POSITIVE_INFINITY)).toBe(
			"L3",
		);
		// Cap at 2: c (in L3) folds up to L2.
		expect(effectiveGroupForTask(doc, "c", 2)).toBe("L2");
		// Cap at 1: c folds all the way to L1.
		expect(effectiveGroupForTask(doc, "c", 1)).toBe("L1");
		// b (in L2) at cap 2 stays in L2.
		expect(effectiveGroupForTask(doc, "b", 2)).toBe("L2");
	});

	it("effectiveGroupForTask returns null for ungrouped tasks or grouping off", () => {
		expect(
			effectiveGroupForTask(doc, "rootTask", Number.POSITIVE_INFINITY),
		).toBe(null);
		expect(effectiveGroupForTask(doc, "a", 0)).toBe(null);
		expect(effectiveGroupForTask(doc, "missing", 2)).toBe(null);
	});
});

describe("filterCollapsedToRendered", () => {
	const doc = build([group("L1"), group("L2", "L1"), group("L3", "L2")], []);

	it("drops collapsed groups the cap has folded away", () => {
		const collapsed = new Set(["L1", "L2", "L3"]);
		const out = filterCollapsedToRendered(doc, collapsed, 2);
		expect([...out].sort()).toEqual(["L1", "L2"]);
	});

	it("returns an empty set when grouping is off", () => {
		const out = filterCollapsedToRendered(doc, new Set(["L1"]), 0);
		expect(out.size).toBe(0);
	});

	it("returns the same set unchanged when uncapped (fast path)", () => {
		const collapsed = new Set(["L1", "L3"]);
		expect(
			filterCollapsedToRendered(doc, collapsed, Number.POSITIVE_INFINITY),
		).toBe(collapsed);
	});
});

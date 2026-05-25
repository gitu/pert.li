import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	getAncestors,
	getChildren,
	getContainers,
	getDescendants,
	getNearestCollapsedAncestor,
	getRootTasks,
	isWithin,
} from "../hierarchy";
import type { PertDoc, Task, TaskKind } from "../types";
import { createEmptyPertDoc } from "../types";

function t(
	id: string,
	parentId: string | null = null,
	kind: TaskKind = "task",
): Task {
	return { id, kind, title: id, parentId };
}

function build(tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("h");
	for (const task of tasks) doc.tasksById[task.id] = task;
	return doc;
}

describe("hierarchy helpers", () => {
	const doc = build([
		t("root", null, "container"),
		t("childA", "root"),
		t("group", "root", "container"),
		t("leaf1", "group"),
		t("leaf2", "group"),
		t("orphan"),
	]);

	it("getChildren returns only direct children", () => {
		expect(
			getChildren(doc, "root")
				.map((x) => x.id)
				.sort(),
		).toEqual(["childA", "group"]);
		expect(
			getChildren(doc, "group")
				.map((x) => x.id)
				.sort(),
		).toEqual(["leaf1", "leaf2"]);
		expect(getChildren(doc, "childA")).toEqual([]);
	});

	it("getRootTasks returns null-parent tasks", () => {
		expect(
			getRootTasks(doc)
				.map((x) => x.id)
				.sort(),
		).toEqual(["orphan", "root"]);
	});

	it("getAncestors walks parentId upward", () => {
		expect(getAncestors(doc, "leaf1")).toEqual(["group", "root"]);
		expect(getAncestors(doc, "childA")).toEqual(["root"]);
		expect(getAncestors(doc, "root")).toEqual([]);
		expect(getAncestors(doc, "missing")).toEqual([]);
	});

	it("getAncestors stops at a parent cycle instead of looping", () => {
		const looped = build([
			{ id: "X", kind: "task", title: "X", parentId: "Y" },
			{ id: "Y", kind: "task", title: "Y", parentId: "X" },
		]);
		const ancestors = getAncestors(looped, "X");
		expect(ancestors.length).toBeLessThanOrEqual(2);
	});

	it("getDescendants gathers the whole subtree", () => {
		expect(getDescendants(doc, "root").sort()).toEqual([
			"childA",
			"group",
			"leaf1",
			"leaf2",
		]);
		expect(getDescendants(doc, "group").sort()).toEqual(["leaf1", "leaf2"]);
		expect(getDescendants(doc, "leaf1")).toEqual([]);
	});

	it("isWithin checks containment", () => {
		expect(isWithin(doc, "leaf1", "root")).toBe(true);
		expect(isWithin(doc, "leaf1", "group")).toBe(true);
		expect(isWithin(doc, "leaf1", "leaf1")).toBe(true);
		expect(isWithin(doc, "orphan", "root")).toBe(false);
		expect(isWithin(doc, "leaf1", "childA")).toBe(false);
	});

	it("getNearestCollapsedAncestor returns the closest collapsed wrapper", () => {
		const collapsed = new Set(["root"]);
		expect(getNearestCollapsedAncestor(doc, "leaf1", collapsed)).toBe("root");
		expect(getNearestCollapsedAncestor(doc, "root", collapsed)).toBe("root");
		expect(getNearestCollapsedAncestor(doc, "orphan", collapsed)).toBe(null);

		const collapsedInner = new Set(["group"]);
		expect(getNearestCollapsedAncestor(doc, "leaf1", collapsedInner)).toBe(
			"group",
		);
		expect(getNearestCollapsedAncestor(doc, "childA", collapsedInner)).toBe(
			null,
		);
	});

	it("getContainers filters to kind === 'container'", () => {
		expect(
			getContainers(doc)
				.map((x) => x.id)
				.sort(),
		).toEqual(["group", "root"]);
	});
});

// Generates a valid forest: each task is placed under a parent with lower
// index, ensuring acyclic parentId chains. Mixes containers and leaves.
function arbDoc(maxTasks = 12): fc.Arbitrary<PertDoc> {
	return fc.integer({ min: 1, max: maxTasks }).chain((n) =>
		fc
			.tuple(
				fc.array(fc.boolean(), { minLength: n, maxLength: n }), // isContainer
				fc.array(fc.integer({ min: -1, max: maxTasks - 1 }), {
					minLength: n,
					maxLength: n,
				}), // parentIdx (or -1 for root)
			)
			.map(([kinds, parents]) => {
				const doc = createEmptyPertDoc("rand");
				for (let i = 0; i < n; i++) {
					const parentIdx = parents[i];
					const parentId =
						parentIdx >= 0 && parentIdx < i ? `T${parentIdx}` : null;
					const kind: TaskKind = kinds[i] ? "container" : "task";
					doc.tasksById[`T${i}`] = {
						id: `T${i}`,
						kind,
						title: `T${i}`,
						parentId,
					};
				}
				return doc;
			}),
	);
}

describe("hierarchy property tests", () => {
	it("ancestors and descendants are dual: A in ancestors(B) iff B in descendants(A)", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				const ids = Object.keys(doc.tasksById);
				for (const a of ids) {
					const desc = new Set(getDescendants(doc, a));
					for (const b of ids) {
						if (b === a) continue;
						const ancestors = new Set(getAncestors(doc, b));
						const expectAInAncestorsOfB = desc.has(b);
						const expectBInDescOfA = ancestors.has(a);
						if (expectAInAncestorsOfB !== expectBInDescOfA) return false;
					}
				}
				return true;
			}),
			{ numRuns: 50 },
		);
	});

	it("isWithin is the transitive closure of getChildren", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				for (const id of Object.keys(doc.tasksById)) {
					for (const desc of getDescendants(doc, id)) {
						if (!isWithin(doc, desc, id)) return false;
					}
				}
				return true;
			}),
			{ numRuns: 50 },
		);
	});

	it("root tasks have no ancestors", () => {
		fc.assert(
			fc.property(arbDoc(), (doc) => {
				for (const root of getRootTasks(doc)) {
					if (getAncestors(doc, root.id).length !== 0) return false;
				}
				return true;
			}),
			{ numRuns: 50 },
		);
	});
});

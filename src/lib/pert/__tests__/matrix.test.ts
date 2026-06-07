import { describe, expect, it } from "vitest";
import {
	addDependencyMutation,
	buildDependencyMatrix,
	removeDependencyMutation,
	shortDependencyType,
	toggleDependencyMutation,
} from "#/lib/pert/matrix";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
	type Task,
} from "#/lib/pert/types";

const est: Estimate = {
	optimistic: 1,
	mostLikely: 2,
	pessimistic: 3,
	unit: "day",
};

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("m");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

function leaf(id: string, title: string): Task {
	return { id, kind: "task", title, estimate: est };
}

describe("buildDependencyMatrix", () => {
	it("orders tasks by title with numeric collation", () => {
		const doc = build(
			leaf("a", "Task 2"),
			leaf("b", "Task 10"),
			leaf("c", "Task 1"),
		);
		const m = buildDependencyMatrix(doc);
		expect(m.tasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
	});

	it("flags the diagonal", () => {
		const doc = build(leaf("a", "Alpha"), leaf("b", "Beta"));
		const m = buildDependencyMatrix(doc);
		expect(m.cells[0][0].diagonal).toBe(true);
		expect(m.cells[0][1].diagonal).toBe(false);
		expect(m.cells[1][1].diagonal).toBe(true);
	});

	it("populates cells with existing dependency id + type", () => {
		const doc = build(leaf("a", "Alpha"), leaf("b", "Beta"));
		doc.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "a" },
			to: { taskId: "b" },
			type: "finish_to_start",
		};
		const m = buildDependencyMatrix(doc);
		const aToB = m.cells[0][1];
		expect(aToB.dependencyId).toBe("ab");
		expect(aToB.type).toBe("finish_to_start");
		const bToA = m.cells[1][0];
		expect(bToA.dependencyId).toBeNull();
		expect(bToA.type).toBeNull();
	});

	it("includes milestones and ignores groups", () => {
		const doc = build(leaf("a", "Alpha"), {
			id: "m",
			kind: "milestone",
			title: "Mile",
		});
		// Groups are not tasks — they never appear as matrix rows.
		doc.groupsById.g = {
			id: "g",
			name: "Group",
			parentGroupId: null,
			order: 0,
		};
		const m = buildDependencyMatrix(doc);
		expect(m.tasks.map((t) => t.id)).toEqual(["a", "m"]);
		expect(m.cells.length).toBe(2);
	});
});

describe("mutations", () => {
	it("addDependencyMutation creates a new dep with a stable id", () => {
		const doc = build(leaf("a", "Alpha"), leaf("b", "Beta"));
		addDependencyMutation("a", "b")(doc);
		const ids = Object.keys(doc.dependenciesById);
		expect(ids).toHaveLength(1);
		const dep = doc.dependenciesById[ids[0]];
		expect(dep.from.taskId).toBe("a");
		expect(dep.to.taskId).toBe("b");
		expect(dep.type).toBe("finish_to_start");
	});

	it("addDependencyMutation is a no-op if an a→b dep already exists", () => {
		const doc = build(leaf("a", "Alpha"), leaf("b", "Beta"));
		doc.dependenciesById.existing = {
			id: "existing",
			from: { taskId: "a" },
			to: { taskId: "b" },
			type: "finish_to_start",
		};
		addDependencyMutation("a", "b")(doc);
		expect(Object.keys(doc.dependenciesById)).toEqual(["existing"]);
	});

	it("removeDependencyMutation deletes by id", () => {
		const doc = build(leaf("a", "Alpha"));
		doc.dependenciesById.x = {
			id: "x",
			from: { taskId: "a" },
			to: { taskId: "a" },
			type: "finish_to_start",
		};
		removeDependencyMutation("x")(doc);
		expect(doc.dependenciesById.x).toBeUndefined();
	});

	it("toggleDependencyMutation returns null for diagonal cells", () => {
		const doc = build(leaf("a", "Alpha"));
		const m = buildDependencyMatrix(doc);
		expect(toggleDependencyMutation(m.cells[0][0])).toBeNull();
	});

	it("toggleDependencyMutation round-trips add → remove", () => {
		const doc = build(leaf("a", "Alpha"), leaf("b", "Beta"));
		const initial = buildDependencyMatrix(doc);
		const addMut = toggleDependencyMutation(initial.cells[0][1]);
		expect(addMut).not.toBeNull();
		addMut?.(doc);
		expect(Object.keys(doc.dependenciesById)).toHaveLength(1);

		// Rebuild — the cell now carries a dependencyId, so toggle removes it.
		const after = buildDependencyMatrix(doc);
		const removeMut = toggleDependencyMutation(after.cells[0][1]);
		expect(removeMut).not.toBeNull();
		removeMut?.(doc);
		expect(Object.keys(doc.dependenciesById)).toHaveLength(0);
	});
});

describe("shortDependencyType", () => {
	it("maps every dependency type to a 2-letter code", () => {
		expect(shortDependencyType("finish_to_start")).toBe("FS");
		expect(shortDependencyType("start_to_start")).toBe("SS");
		expect(shortDependencyType("finish_to_finish")).toBe("FF");
		expect(shortDependencyType("start_to_finish")).toBe("SF");
	});
});

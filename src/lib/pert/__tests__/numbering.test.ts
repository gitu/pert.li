import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeNumbering } from "../numbering";
import {
	createEmptyPertDoc,
	type Group,
	type PertDoc,
	type Task,
} from "../types";

function group(id: string, parentGroupId: string | null, order: number): Group {
	return { id, name: id, parentGroupId, order };
}

function task(
	id: string,
	groupId: string | null,
	order?: number,
	numberOverride?: string,
): Task {
	const t: Task = { id, kind: "task", title: id };
	if (groupId !== null) t.groupId = groupId;
	if (order !== undefined) t.order = order;
	if (numberOverride !== undefined) t.numberOverride = numberOverride;
	return t;
}

function docFrom(groups: Group[], tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("test");
	for (const g of groups) doc.groupsById[g.id] = g;
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

describe("computeNumbering — examples", () => {
	it("numbers root groups 1, 2, … by sibling order", () => {
		const doc = docFrom([group("b", null, 1), group("a", null, 0)], []);
		const { groups } = computeNumbering(doc);
		expect(groups.a).toBe("1");
		expect(groups.b).toBe("2");
	});

	it("numbers nested groups and member tasks as WBS", () => {
		const doc = docFrom(
			[group("g1", null, 0), group("g1a", "g1", 0)],
			[task("t1", "g1", 0), task("t2", "g1", 1), task("t3", "g1a", 0)],
		);
		const { groups, tasks } = computeNumbering(doc);
		expect(groups.g1).toBe("1");
		expect(groups.g1a).toBe("1.1");
		expect(tasks.t1).toBe("1.1"); // careful: member index, not the child group
		// t1 is the first MEMBER of g1; g1a is the first CHILD GROUP of g1.
		// Member numbering and child-group numbering both start at 1 under "1",
		// so t1 = "1.1" and g1a = "1.1". This is acceptable (they live in
		// different visual trees: tasks vs boxes).
		expect(tasks.t2).toBe("1.2");
		expect(tasks.t3).toBe("1.1.1");
	});

	it("ungrouped task with no override has empty number", () => {
		const doc = docFrom([], [task("t1", null)]);
		expect(computeNumbering(doc).tasks.t1).toBe("");
	});

	it("override wins over the derived number", () => {
		const doc = docFrom([group("g1", null, 0)], [task("t1", "g1", 0, "X.9")]);
		expect(computeNumbering(doc).tasks.t1).toBe("X.9");
	});
});

// A small arbitrary: a forest of groups + tasks assigned to existing groups.
const scenarioArb = fc
	.record({
		groupCount: fc.integer({ min: 0, max: 5 }),
		taskCount: fc.integer({ min: 0, max: 8 }),
		seed: fc.integer({ min: 0, max: 1_000_000 }),
	})
	.map(({ groupCount, taskCount, seed }) => {
		// Deterministic pseudo-random from seed (no Math.random in this env).
		let s = seed + 1;
		const rand = () => {
			s = (s * 1103515245 + 12345) & 0x7fffffff;
			return s / 0x7fffffff;
		};
		const groups: Group[] = [];
		for (let i = 0; i < groupCount; i++) {
			// parent is a lower-index group (keeps the forest acyclic) or null.
			const parentIdx = i === 0 ? -1 : Math.floor(rand() * (i + 1)) - 1;
			groups.push(group(`g${i}`, parentIdx >= 0 ? `g${parentIdx}` : null, i));
		}
		const tasks: Task[] = [];
		for (let i = 0; i < taskCount; i++) {
			const gi = groupCount > 0 ? Math.floor(rand() * (groupCount + 1)) : 0;
			const gid = gi < groupCount ? `g${gi}` : null;
			tasks.push(task(`t${i}`, gid, i));
		}
		return { groups, tasks };
	});

describe("computeNumbering — properties", () => {
	it("prefix invariant: a member task's number starts with its group number + '.'", () => {
		fc.assert(
			fc.property(scenarioArb, ({ groups, tasks }) => {
				const doc = docFrom(groups, tasks);
				const r = computeNumbering(doc);
				for (const t of tasks) {
					const gid = t.groupId ?? null;
					if (!gid) continue;
					const gn = r.groups[gid];
					const tn = r.tasks[t.id];
					expect(tn.startsWith(`${gn}.`)).toBe(true);
				}
			}),
		);
	});

	it("child group number starts with parent group number + '.'", () => {
		fc.assert(
			fc.property(scenarioArb, ({ groups, tasks }) => {
				const doc = docFrom(groups, tasks);
				const r = computeNumbering(doc);
				for (const g of groups) {
					if (!g.parentGroupId) continue;
					expect(
						r.groups[g.id].startsWith(`${r.groups[g.parentGroupId]}.`),
					).toBe(true);
				}
			}),
		);
	});

	it("is deterministic regardless of key-insertion order (merge-stable)", () => {
		fc.assert(
			fc.property(scenarioArb, ({ groups, tasks }) => {
				const a = computeNumbering(docFrom(groups, tasks));
				const b = computeNumbering(
					docFrom([...groups].reverse(), [...tasks].reverse()),
				);
				expect(b).toEqual(a);
			}),
		);
	});

	it("setting an override makes the task's number equal the override", () => {
		fc.assert(
			fc.property(
				scenarioArb,
				fc.string({ minLength: 1, maxLength: 5 }),
				({ groups, tasks }, override) => {
					if (tasks.length === 0) return;
					const overridden = tasks.map((t, i) =>
						i === 0 ? { ...t, numberOverride: override } : t,
					);
					const r = computeNumbering(docFrom(groups, overridden));
					expect(r.tasks[tasks[0].id]).toBe(override);
				},
			),
		);
	});

	it("moving a task to another group keeps its override intact", () => {
		const doc = docFrom(
			[group("g1", null, 0), group("g2", null, 1)],
			[task("t1", "g1", 0, "PIN")],
		);
		expect(computeNumbering(doc).tasks.t1).toBe("PIN");
		// Move it.
		doc.tasksById.t1.groupId = "g2";
		expect(computeNumbering(doc).tasks.t1).toBe("PIN");
	});

	it("an empty group still gets a number and shifts later siblings", () => {
		const doc = docFrom(
			[group("a", null, 0), group("b", null, 1), group("c", null, 2)],
			[task("t", "c", 0)],
		);
		const r = computeNumbering(doc);
		expect(r.groups.a).toBe("1");
		expect(r.groups.b).toBe("2");
		expect(r.groups.c).toBe("3");
		expect(r.tasks.t).toBe("3.1");
	});

	it("terminates on a parentGroupId cycle (treats cyclic groups as roots)", () => {
		const doc = docFrom(
			[group("x", "y", 0), group("y", "x", 1)],
			[task("t", "x", 0)],
		);
		// Must not hang; every group gets some number.
		const r = computeNumbering(doc);
		expect(typeof r.groups.x).toBe("string");
		expect(typeof r.groups.y).toBe("string");
		expect(r.tasks.t.startsWith(`${r.groups.x}.`)).toBe(true);
	});
});

import { describe, expect, it } from "vitest";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { applyOperations } from "../apply-operations";
import type { EditOp } from "../operations";

function seed(): PertDoc {
	const d = createEmptyPertDoc("ops test");
	d.tasksById.A = {
		id: "A",
		kind: "task",
		title: "A",
		estimate: { optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "B",
		estimate: { optimistic: 2, mostLikely: 4, pessimistic: 6, unit: "day" },
	};
	return d;
}

describe("applyOperations", () => {
	it("walks a mixed batch of edits, returning per-op results", () => {
		const doc = seed();
		const ops: EditOp[] = [
			{ op: "set_title", taskId: "A", title: "Alpha v2" },
			{
				op: "set_estimate",
				taskId: "B",
				optimistic: 3,
				mostLikely: 5,
				pessimistic: 8,
			},
			{ op: "add_task", title: "C", id: "C" },
			{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "dep1" },
		];
		const results = applyOperations(doc, ops);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(doc.tasksById.A.title).toBe("Alpha v2");
		expect(doc.tasksById.B.estimate).toEqual({
			optimistic: 3,
			mostLikely: 5,
			pessimistic: 8,
			unit: "day",
		});
		expect(doc.tasksById.C).toBeDefined();
		expect(doc.dependenciesById.dep1).toBeDefined();
	});

	it("surfaces per-op errors without stopping the batch", () => {
		const doc = seed();
		const ops: EditOp[] = [
			{ op: "set_title", taskId: "Z", title: "ghost" },
			{ op: "set_title", taskId: "A", title: "still applies" },
		];
		const results = applyOperations(doc, ops);
		expect(results[0]).toMatchObject({ ok: false });
		expect(results[1]).toMatchObject({ ok: true });
		expect(doc.tasksById.A.title).toBe("still applies");
	});

	it("supports forward-references via client-provided ids", () => {
		const doc = seed();
		const ops: EditOp[] = [
			{ op: "add_task", id: "C", title: "C" },
			{ op: "add_dependency", fromTaskId: "C", toTaskId: "A", id: "ca" },
		];
		const results = applyOperations(doc, ops);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(doc.dependenciesById.ca).toBeDefined();
		expect(doc.dependenciesById.ca.from.taskId).toBe("C");
	});

	describe("group imports", () => {
		it("accepts a task that forward-references a group created later in the batch", () => {
			const doc = seed();
			const ops: EditOp[] = [
				// Task BEFORE its group — the model emits this ordering regularly
				// when importing structured documents.
				{ op: "add_task", id: "child", title: "Child", groupId: "phase" },
				{ op: "create_group", id: "phase", name: "Phase 1" },
			];
			const results = applyOperations(doc, ops);
			expect(results.every((r) => r.ok)).toBe(true);
			expect(doc.tasksById.child.groupId).toBe("phase");
			expect(doc.groupsById.phase.name).toBe("Phase 1");
		});

		it("accepts move_task_to_group referencing a group created earlier in the batch", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{ op: "create_group", id: "phase", name: "Phase 1" },
				{ op: "move_task_to_group", taskId: "A", groupId: "phase" },
			]);
			expect(results.every((r) => r.ok)).toBe(true);
			expect(doc.tasksById.A.groupId).toBe("phase");
		});

		it("rejects add_task with a groupId that exists nowhere (doc or batch)", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{ op: "add_task", id: "child", title: "Child", groupId: "ghost" },
			]);
			expect(results[0]).toMatchObject({ ok: false });
			expect(doc.tasksById.child).toBeUndefined();
		});

		it("clears the groupId of a child whose forward-referenced group op failed", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				// Child references a group the batch *claims* to create…
				{ op: "add_task", id: "child", title: "Child", groupId: "phase" },
				// …but the create op itself fails (bogus parent group), so the
				// child would dangle. The post-batch pass clears it to null.
				{
					op: "create_group",
					id: "phase",
					name: "Phase 1",
					parentGroupId: "ghost",
				},
			]);
			expect(results[0]).toMatchObject({ ok: true });
			expect(results[1]).toMatchObject({ ok: false });
			expect(doc.tasksById.child).toBeDefined();
			expect(doc.tasksById.child.groupId).toBeNull();
		});

		it("nests groups created in the same batch", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{ op: "create_group", id: "outer", name: "Outer" },
				{
					op: "create_group",
					id: "inner",
					name: "Inner",
					parentGroupId: "outer",
				},
				{ op: "add_task", id: "leaf", title: "Leaf", groupId: "inner" },
			]);
			expect(results.every((r) => r.ok)).toBe(true);
			expect(doc.groupsById.inner.parentGroupId).toBe("outer");
			expect(doc.tasksById.leaf.groupId).toBe("inner");
		});
	});

	describe("multiple imports (id collisions)", () => {
		it("remaps colliding client ids to fresh ids instead of overwriting", () => {
			const doc = seed();
			// First import staged a group + task with generic ids.
			applyOperations(doc, [
				{ op: "create_group", id: "phase_1", name: "Design" },
				{ op: "add_task", id: "t1", title: "Wireframes", groupId: "phase_1" },
			]);
			// Second, independent import uses the SAME generic ids.
			const results = applyOperations(doc, [
				{ op: "create_group", id: "phase_1", name: "Backend" },
				{ op: "add_task", id: "t1", title: "API schema", groupId: "phase_1" },
			]);
			expect(results.every((r) => r.ok)).toBe(true);
			// First import's entities are untouched.
			expect(doc.groupsById.phase_1.name).toBe("Design");
			expect(doc.tasksById.t1.title).toBe("Wireframes");
			expect(doc.tasksById.t1.groupId).toBe("phase_1");
			// Second import's entities exist under fresh ids, grouped correctly.
			const titles = Object.values(doc.tasksById).map((t) => t.title);
			expect(titles).toContain("API schema");
			const backend = Object.values(doc.groupsById).find(
				(g) => g.name === "Backend",
			);
			const apiTask = Object.values(doc.tasksById).find(
				(t) => t.title === "API schema",
			);
			expect(backend?.id).not.toBe("phase_1");
			expect(apiTask?.groupId).toBe(backend?.id);
		});

		it("remaps dependency references along with the task ids", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_task", id: "x", title: "First X" },
				{ op: "add_task", id: "y", title: "First Y" },
				{ op: "add_dependency", id: "d1", fromTaskId: "x", toTaskId: "y" },
			]);
			const results = applyOperations(doc, [
				{ op: "add_task", id: "x", title: "Second X" },
				{ op: "add_task", id: "y", title: "Second Y" },
				{ op: "add_dependency", id: "d1", fromTaskId: "x", toTaskId: "y" },
			]);
			expect(results.every((r) => r.ok)).toBe(true);
			// Two distinct dependencies exist, each wiring its own import's tasks.
			const deps = Object.values(doc.dependenciesById);
			expect(deps).toHaveLength(2);
			const second = deps.find((d) => d.id !== "d1");
			expect(second).toBeDefined();
			const fromTask = doc.tasksById[second?.from.taskId ?? ""];
			const toTask = doc.tasksById[second?.to.taskId ?? ""];
			expect(fromTask?.title).toBe("Second X");
			expect(toTask?.title).toBe("Second Y");
		});

		it("remaps follow-up edits (set_estimate, set_notes) to the remapped task", () => {
			const doc = seed();
			applyOperations(doc, [{ op: "add_task", id: "t", title: "Original" }]);
			applyOperations(doc, [
				{ op: "add_task", id: "t", title: "Imported" },
				{
					op: "set_estimate",
					taskId: "t",
					optimistic: 1,
					mostLikely: 2,
					pessimistic: 3,
				},
				{ op: "set_notes", taskId: "t", notes: "from the second import" },
			]);
			// Original task untouched.
			expect(doc.tasksById.t.title).toBe("Original");
			expect(doc.tasksById.t.notes).toBeUndefined();
			// The imported task got the follow-up edits.
			const imported = Object.values(doc.tasksById).find(
				(t) => t.title === "Imported",
			);
			expect(imported?.notes).toBe("from the second import");
			expect(imported?.estimate?.mostLikely).toBe(2);
		});
	});

	// One test per remaining op variant — small, focused, so any future
	// change to a mutator that breaks dispatch is caught by a named test.
	describe("variants", () => {
		it("set_kind: task → milestone drops the estimate", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "set_kind", taskId: "A", kind: "milestone" },
			]);
			expect(doc.tasksById.A.kind).toBe("milestone");
			expect(doc.tasksById.A.estimate).toBeUndefined();
		});

		it("set_task_number sets and clears via null", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "set_task_number", taskId: "A", number: "M1.A" },
			]);
			expect(doc.tasksById.A.numberOverride).toBe("M1.A");
			applyOperations(doc, [
				{ op: "set_task_number", taskId: "A", number: null },
			]);
			expect(doc.tasksById.A.numberOverride).toBeUndefined();
		});

		it("set_notes sets and clears", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "set_notes", taskId: "A", notes: "details" },
			]);
			expect(doc.tasksById.A.notes).toBe("details");
			applyOperations(doc, [{ op: "set_notes", taskId: "A", notes: null }]);
			expect(doc.tasksById.A.notes).toBeUndefined();
		});

		it("set_status in_progress stamps actualStart and seeds progress", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "set_status", taskId: "A", status: "in_progress" },
			]);
			expect(doc.tasksById.A.status).toBe("in_progress");
			expect(doc.tasksById.A.actualStart).toBeDefined();
			expect(doc.tasksById.A.progress).toBe(0);
		});

		it("set_progress clamps and auto-promotes to completed at 100", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "set_progress", taskId: "A", progress: 130 },
			]);
			expect(doc.tasksById.A.progress).toBe(100);
			expect(doc.tasksById.A.status).toBe("completed");
			expect(doc.tasksById.A.actualFinish).toBeDefined();
		});

		it("set_actual_dates clears and sets", () => {
			const doc = seed();
			applyOperations(doc, [
				{
					op: "set_actual_dates",
					taskId: "A",
					actualStart: "2026-06-01",
					actualFinish: "2026-06-05",
				},
			]);
			expect(doc.tasksById.A.actualStart).toBe("2026-06-01");
			expect(doc.tasksById.A.actualFinish).toBe("2026-06-05");
			applyOperations(doc, [
				{
					op: "set_actual_dates",
					taskId: "A",
					actualStart: null,
				},
			]);
			expect(doc.tasksById.A.actualStart).toBeUndefined();
			expect(doc.tasksById.A.actualFinish).toBe("2026-06-05");
		});

		it("set_actual_dates rejects non-ISO strings", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{ op: "set_actual_dates", taskId: "A", actualStart: "not-a-date" },
			]);
			expect(results[0]).toMatchObject({ ok: false });
		});

		it("move_task_to_group assigns and clears a task's group", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "create_group", id: "G", name: "Group" },
				{ op: "move_task_to_group", taskId: "A", groupId: "G" },
			]);
			expect(doc.tasksById.A.groupId).toBe("G");
			applyOperations(doc, [
				{ op: "move_task_to_group", taskId: "A", groupId: null },
			]);
			expect(doc.tasksById.A.groupId).toBeNull();
		});

		it("move_task_to_group rejects an unknown group", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{ op: "move_task_to_group", taskId: "A", groupId: "ghost" },
			]);
			expect(results[0]).toMatchObject({ ok: false });
			expect(doc.tasksById.A.groupId ?? null).toBeNull();
		});

		it("set_dependency edits type and lag; lagDays=null clears", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "ab" },
				{
					op: "set_dependency",
					dependencyId: "ab",
					type: "start_to_start",
					lagDays: 3,
				},
			]);
			expect(doc.dependenciesById.ab.type).toBe("start_to_start");
			expect(doc.dependenciesById.ab.lagDays).toBe(3);
			applyOperations(doc, [
				{ op: "set_dependency", dependencyId: "ab", lagDays: null },
			]);
			expect(doc.dependenciesById.ab.lagDays).toBeUndefined();
		});

		it("remove_dependency deletes a single edge", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "ab" },
				{ op: "remove_dependency", dependencyId: "ab" },
			]);
			expect(doc.dependenciesById.ab).toBeUndefined();
		});

		it("remove_task deletes its touching deps", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "ab" },
				{ op: "remove_task", taskId: "B" },
			]);
			expect(doc.tasksById.B).toBeUndefined();
			// The dep touching B is cascaded away.
			expect(doc.dependenciesById.ab).toBeUndefined();
		});

		it("create_group / rename_group / set_group_parent / delete_group lifecycle", () => {
			const doc = seed();
			const addResults = applyOperations(doc, [
				{ op: "create_group", id: "g1", name: "Parent" },
				{ op: "create_group", id: "g2", name: "Child", parentGroupId: "g1" },
			]);
			expect(addResults.every((r) => r.ok)).toBe(true);
			expect(doc.groupsById.g2.parentGroupId).toBe("g1");

			applyOperations(doc, [
				{ op: "rename_group", groupId: "g1", name: "Renamed" },
				{ op: "move_task_to_group", taskId: "A", groupId: "g2" },
			]);
			expect(doc.groupsById.g1.name).toBe("Renamed");
			expect(doc.tasksById.A.groupId).toBe("g2");

			// Promote g2 back to root.
			applyOperations(doc, [
				{ op: "set_group_parent", groupId: "g2", parentGroupId: null },
			]);
			expect(doc.groupsById.g2.parentGroupId).toBeNull();

			// Delete g2 → its member task A is promoted (g2 is now a root, so A
			// becomes ungrouped) and the task survives.
			applyOperations(doc, [{ op: "delete_group", groupId: "g2" }]);
			expect(doc.groupsById.g2).toBeUndefined();
			expect(doc.tasksById.A).toBeDefined();
			expect(doc.tasksById.A.groupId).toBeNull();
		});

		it("set_group_parent rejects a move that would create a cycle", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "create_group", id: "g1", name: "One" },
				{ op: "create_group", id: "g2", name: "Two", parentGroupId: "g1" },
			]);
			const results = applyOperations(doc, [
				{ op: "set_group_parent", groupId: "g1", parentGroupId: "g2" },
			]);
			expect(results[0]).toMatchObject({ ok: false });
			expect(doc.groupsById.g1.parentGroupId).toBeNull();
		});

		it("add_dependency dedupes when the edge already exists", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "first" },
			]);
			const results = applyOperations(doc, [
				// Same endpoints, different requested id — mutator should return
				// the existing dep id and NOT create a new one.
				{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "second" },
			]);
			expect(results[0]).toMatchObject({ ok: true, id: "first" });
			expect(doc.dependenciesById.second).toBeUndefined();
		});

		it("set_estimate rejects optimistic > mostLikely > pessimistic violations", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{
					op: "set_estimate",
					taskId: "A",
					optimistic: 5,
					mostLikely: 3,
					pessimistic: 8,
				},
			]);
			expect(results[0]).toMatchObject({ ok: false });
		});
	});
});

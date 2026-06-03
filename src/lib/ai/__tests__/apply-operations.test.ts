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
		parentId: null,
		estimate: { optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "B",
		parentId: null,
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

	describe("nested imports", () => {
		it("accepts children that forward-reference a container added later in the batch", () => {
			const doc = seed();
			const ops: EditOp[] = [
				// Child BEFORE its parent container — the model emits this ordering
				// regularly when importing structured documents.
				{ op: "add_task", id: "child", title: "Child", parentId: "phase" },
				{
					op: "add_task",
					id: "phase",
					title: "Phase 1",
					kind: "container",
				},
			];
			const results = applyOperations(doc, ops);
			expect(results.every((r) => r.ok)).toBe(true);
			expect(doc.tasksById.child.parentId).toBe("phase");
			expect(doc.tasksById.phase.kind).toBe("container");
		});

		it("rejects add_task with a parentId that exists nowhere (doc or batch)", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{ op: "add_task", id: "child", title: "Child", parentId: "ghost" },
			]);
			expect(results[0]).toMatchObject({ ok: false });
			expect(doc.tasksById.child).toBeUndefined();
		});

		it("re-roots a child whose forward-referenced parent op failed", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				// Child references a container that the batch *claims* to add…
				{ op: "add_task", id: "child", title: "Child", parentId: "phase" },
				// …but the container op itself fails (parent of the container is
				// bogus), so the child would dangle. The post-batch pass re-roots it.
				{
					op: "add_task",
					id: "phase",
					title: "Phase 1",
					kind: "container",
					parentId: "ghost",
				},
			]);
			expect(results[0]).toMatchObject({ ok: true });
			expect(results[1]).toMatchObject({ ok: false });
			expect(doc.tasksById.child).toBeDefined();
			// Visible at the root instead of invisible under a missing parent.
			expect(doc.tasksById.child.parentId).toBeNull();
		});

		it("re-roots children whose parent gets demoted to a leaf in the same batch", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_task", id: "box", title: "Box", kind: "container" },
				{ op: "add_task", id: "child", title: "Child", parentId: "box" },
				// Later in the batch the parent stops being a container — only
				// containers may have children, so the child must be re-rooted.
				{ op: "set_kind", taskId: "box", kind: "task" },
			]);
			expect(doc.tasksById.box.kind).toBe("task");
			expect(doc.tasksById.child.parentId).toBeNull();
		});

		it("re-roots tasks whose forward references form a parent cycle", () => {
			const doc = seed();
			applyOperations(doc, [
				{
					op: "add_task",
					id: "c1",
					title: "C1",
					kind: "container",
					parentId: "c2",
				},
				{
					op: "add_task",
					id: "c2",
					title: "C2",
					kind: "container",
					parentId: "c1",
				},
			]);
			// Both exist; at least one was re-rooted so the chain terminates.
			expect(doc.tasksById.c1).toBeDefined();
			expect(doc.tasksById.c2).toBeDefined();
			const chainTerminates = (id: string): boolean => {
				const seen = new Set<string>([id]);
				let cursor = doc.tasksById[id]?.parentId ?? null;
				while (cursor) {
					if (seen.has(cursor) || !doc.tasksById[cursor]) return false;
					seen.add(cursor);
					cursor = doc.tasksById[cursor].parentId ?? null;
				}
				return true;
			};
			expect(chainTerminates("c1")).toBe(true);
			expect(chainTerminates("c2")).toBe(true);
		});
	});

	describe("multiple imports (id collisions)", () => {
		it("remaps colliding client ids to fresh ids instead of overwriting", () => {
			const doc = seed();
			// First import staged a container + child with generic ids.
			applyOperations(doc, [
				{ op: "add_task", id: "phase_1", title: "Design", kind: "container" },
				{ op: "add_task", id: "t1", title: "Wireframes", parentId: "phase_1" },
			]);
			// Second, independent import uses the SAME generic ids.
			const results = applyOperations(doc, [
				{ op: "add_task", id: "phase_1", title: "Backend", kind: "container" },
				{ op: "add_task", id: "t1", title: "API schema", parentId: "phase_1" },
			]);
			expect(results.every((r) => r.ok)).toBe(true);
			// First import's tasks are untouched.
			expect(doc.tasksById.phase_1.title).toBe("Design");
			expect(doc.tasksById.t1.title).toBe("Wireframes");
			expect(doc.tasksById.t1.parentId).toBe("phase_1");
			// Second import's tasks exist under fresh ids, nested correctly.
			const titles = Object.values(doc.tasksById).map((t) => t.title);
			expect(titles).toContain("Backend");
			expect(titles).toContain("API schema");
			const backend = Object.values(doc.tasksById).find(
				(t) => t.title === "Backend",
			);
			const apiTask = Object.values(doc.tasksById).find(
				(t) => t.title === "API schema",
			);
			expect(backend?.id).not.toBe("phase_1");
			expect(apiTask?.parentId).toBe(backend?.id);
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

		it("set_key sets and clears via empty string", () => {
			const doc = seed();
			applyOperations(doc, [{ op: "set_key", taskId: "A", key: "M1.A" }]);
			expect(doc.tasksById.A.key).toBe("M1.A");
			applyOperations(doc, [{ op: "set_key", taskId: "A", key: null }]);
			expect(doc.tasksById.A.key).toBeUndefined();
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

		it("move_task reparents under a container", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_task", id: "P", title: "Parent", kind: "container" },
				{ op: "move_task", taskId: "A", parentId: "P" },
			]);
			expect(doc.tasksById.A.parentId).toBe("P");
		});

		it("move_task rejects non-container parents", () => {
			const doc = seed();
			const results = applyOperations(doc, [
				{ op: "move_task", taskId: "A", parentId: "B" },
			]);
			expect(results[0]).toMatchObject({ ok: false });
			expect(doc.tasksById.A.parentId).toBeNull();
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

		it("remove_task deletes deps and reparents its children", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_task", id: "P", title: "Parent", kind: "container" },
				{ op: "move_task", taskId: "A", parentId: "P" },
				{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "ab" },
				{ op: "remove_task", taskId: "P" },
			]);
			expect(doc.tasksById.P).toBeUndefined();
			// A is promoted back to top level.
			expect(doc.tasksById.A.parentId).toBeNull();
			// A's outgoing dep survives — only deps touching P would be dropped.
			expect(doc.dependenciesById.ab).toBeDefined();
		});

		it("add_interface / set_interface / remove_interface lifecycle", () => {
			const doc = seed();
			const addResults = applyOperations(doc, [
				{ op: "add_task", id: "C", title: "Container", kind: "container" },
				{
					op: "add_interface",
					id: "if1",
					containerId: "C",
					kind: "entry",
					label: "input",
				},
			]);
			expect(addResults.every((r) => r.ok)).toBe(true);
			expect(doc.interfacesByContainerId.C?.if1).toBeDefined();
			expect(doc.interfacesByContainerId.C.if1.label).toBe("input");

			applyOperations(doc, [
				{
					op: "set_interface",
					containerId: "C",
					interfaceId: "if1",
					label: "renamed",
					taskRef: "A",
				},
			]);
			expect(doc.interfacesByContainerId.C.if1.label).toBe("renamed");
			expect(doc.interfacesByContainerId.C.if1.taskRef).toBe("A");

			applyOperations(doc, [
				{ op: "remove_interface", containerId: "C", interfaceId: "if1" },
			]);
			expect(doc.interfacesByContainerId.C.if1).toBeUndefined();
		});

		it("pin_dependency sets and clears the interface hint", () => {
			const doc = seed();
			applyOperations(doc, [
				{ op: "add_task", id: "C", title: "Container", kind: "container" },
				{
					op: "add_interface",
					id: "if1",
					containerId: "C",
					kind: "exit",
				},
				{ op: "add_dependency", fromTaskId: "A", toTaskId: "B", id: "ab" },
				{
					op: "pin_dependency",
					dependencyId: "ab",
					side: "from",
					interfaceId: "if1",
				},
			]);
			expect(doc.dependenciesById.ab.from.interfaceId).toBe("if1");
			applyOperations(doc, [
				{
					op: "pin_dependency",
					dependencyId: "ab",
					side: "from",
					interfaceId: null,
				},
			]);
			expect(doc.dependenciesById.ab.from.interfaceId).toBeUndefined();
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

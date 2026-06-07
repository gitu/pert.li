import { describe, expect, it } from "vitest";
import { editOpSchema } from "../operations";

// The editOpSchema is the contract between the LLM and applyOperations.
// These tests pin down the shape so a refactor that drops a variant or
// loosens a constraint trips a unit test rather than a model run.

describe("editOpSchema", () => {
	it("accepts a representative example of every variant", () => {
		const cases = [
			{
				op: "add_task",
				title: "T1",
				kind: "task",
				estimate: { optimistic: 1, mostLikely: 2, pessimistic: 3, unit: "day" },
			},
			{ op: "remove_task", taskId: "A" },
			{ op: "set_title", taskId: "A", title: "renamed" },
			{ op: "set_kind", taskId: "A", kind: "milestone" },
			{ op: "set_task_number", taskId: "A", number: "1.2" },
			{ op: "set_task_number", taskId: "A", number: null },
			{ op: "set_notes", taskId: "A", notes: "hello" },
			{
				op: "set_estimate",
				taskId: "A",
				optimistic: 1,
				mostLikely: 2,
				pessimistic: 3,
			},
			{ op: "set_status", taskId: "A", status: "in_progress" },
			{ op: "set_progress", taskId: "A", progress: 42 },
			{
				op: "set_actual_dates",
				taskId: "A",
				actualStart: "2026-06-01",
				actualFinish: null,
			},
			{ op: "move_task_to_group", taskId: "A", groupId: null },
			{ op: "move_task_to_group", taskId: "A", groupId: "g1" },
			{ op: "add_dependency", fromTaskId: "A", toTaskId: "B" },
			{ op: "remove_dependency", dependencyId: "ab" },
			{
				op: "set_dependency",
				dependencyId: "ab",
				type: "start_to_start",
				lagDays: 3,
			},
			{ op: "create_group", name: "Phase 1" },
			{ op: "create_group", id: "g1", name: "Phase 1", parentGroupId: null },
			{ op: "rename_group", groupId: "g1", name: "renamed" },
			{ op: "set_group_parent", groupId: "g1", parentGroupId: "g0" },
			{ op: "delete_group", groupId: "g1" },
		];
		for (const c of cases) {
			const result = editOpSchema.safeParse(c);
			expect(
				result.success,
				`expected ${c.op} to parse but got ${JSON.stringify(result.success ? null : result.error.issues)}`,
			).toBe(true);
		}
	});

	it("rejects unknown op names", () => {
		const r = editOpSchema.safeParse({ op: "delete_planet", taskId: "A" });
		expect(r.success).toBe(false);
	});

	it("rejects missing required fields", () => {
		expect(
			editOpSchema.safeParse({ op: "set_title", taskId: "A" }).success,
		).toBe(false);
		expect(
			editOpSchema.safeParse({ op: "set_estimate", taskId: "A" }).success,
		).toBe(false);
		expect(
			editOpSchema.safeParse({ op: "add_dependency", fromTaskId: "A" }).success,
		).toBe(false);
	});

	it("rejects an empty title on add_task / set_title", () => {
		expect(editOpSchema.safeParse({ op: "add_task", title: "" }).success).toBe(
			false,
		);
		expect(
			editOpSchema.safeParse({ op: "set_title", taskId: "A", title: "" })
				.success,
		).toBe(false);
	});

	it("rejects malformed ISO date on set_actual_dates", () => {
		const r = editOpSchema.safeParse({
			op: "set_actual_dates",
			taskId: "A",
			actualStart: "2026/06/01",
		});
		expect(r.success).toBe(false);
	});

	it("rejects unknown enum values for kind / status / type", () => {
		expect(
			editOpSchema.safeParse({ op: "set_kind", taskId: "A", kind: "epic" })
				.success,
		).toBe(false);
		expect(
			editOpSchema.safeParse({
				op: "set_status",
				taskId: "A",
				status: "blocked",
			}).success,
		).toBe(false);
		expect(
			editOpSchema.safeParse({
				op: "set_dependency",
				dependencyId: "ab",
				type: "blocks",
			}).success,
		).toBe(false);
	});
});

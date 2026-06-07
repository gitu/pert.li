import { describe, expect, it } from "vitest";
import {
	dropTaskMutation,
	reAddTaskMutation,
	restoreAllTaskFieldsMutation,
	restoreDependencyMutation,
	restoreTaskFieldMutation,
} from "#/lib/pert/restore";
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

function build(...tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("r");
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

describe("restoreTaskFieldMutation", () => {
	it("restores the estimate while leaving layout untouched", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
			estimate: est(1, 2, 3),
		});
		const current = build({
			id: "A",
			kind: "task",
			title: "A renamed",
			estimate: est(5, 7, 10),
			layout: { position: { x: 200, y: 100 } },
		});
		const mut = restoreTaskFieldMutation(snapshot, "A", "estimate");
		expect(mut).not.toBeNull();
		mut?.(current);
		expect(current.tasksById.A.estimate).toEqual(est(1, 2, 3));
		expect(current.tasksById.A.title).toBe("A renamed");
		expect(current.tasksById.A.layout?.position).toEqual({ x: 200, y: 100 });
	});

	it("returns null when the task is missing from the snapshot", () => {
		const snapshot = build();
		expect(restoreTaskFieldMutation(snapshot, "A", "title")).toBeNull();
		expect(restoreTaskFieldMutation(snapshot, "missing", "title")).toBeNull();
	});

	it("no-ops when the task is missing on the current doc", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
		});
		const current = build();
		const mut = restoreTaskFieldMutation(snapshot, "A", "title");
		mut?.(current);
		expect(current.tasksById.A).toBeUndefined();
	});

	it("clears notes/estimate when the snapshot has none", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
		});
		const current = build({
			id: "A",
			kind: "task",
			title: "A",
			estimate: est(1, 2, 3),
			notes: "scratch",
		});
		restoreTaskFieldMutation(snapshot, "A", "estimate")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "notes")?.(current);
		expect(current.tasksById.A.estimate).toBeUndefined();
		expect(current.tasksById.A.notes).toBeUndefined();
	});

	it("restores key, status, progress, and actual dates from snapshot", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
			numberOverride: "M1.A",
			status: "in_progress",
			progress: 40,
			actualStart: "2026-05-20",
		});
		const current = build({
			id: "A",
			kind: "task",
			title: "A",
			status: "completed",
			progress: 100,
			actualStart: "2026-05-25",
			actualFinish: "2026-06-01",
		});
		restoreTaskFieldMutation(snapshot, "A", "numberOverride")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "status")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "progress")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "actualStart")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "actualFinish")?.(current);
		expect(current.tasksById.A.numberOverride).toBe("M1.A");
		expect(current.tasksById.A.status).toBe("in_progress");
		expect(current.tasksById.A.progress).toBe(40);
		expect(current.tasksById.A.actualStart).toBe("2026-05-20");
		// Snapshot has no actualFinish → restored to absent.
		expect(current.tasksById.A.actualFinish).toBeUndefined();
	});

	it("clears key/status/progress/actual dates when the snapshot has none", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
		});
		const current = build({
			id: "A",
			kind: "task",
			title: "A",
			numberOverride: "M1.A",
			status: "in_progress",
			progress: 40,
			actualStart: "2026-05-20",
			actualFinish: "2026-06-01",
		});
		restoreTaskFieldMutation(snapshot, "A", "numberOverride")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "status")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "progress")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "actualStart")?.(current);
		restoreTaskFieldMutation(snapshot, "A", "actualFinish")?.(current);
		expect(current.tasksById.A.numberOverride).toBeUndefined();
		expect(current.tasksById.A.status).toBeUndefined();
		expect(current.tasksById.A.progress).toBeUndefined();
		expect(current.tasksById.A.actualStart).toBeUndefined();
		expect(current.tasksById.A.actualFinish).toBeUndefined();
	});

	it("trims and clears whitespace-only key on restore (matches setKeyMutation)", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
			numberOverride: "   ",
		});
		const current = build({
			id: "A",
			kind: "task",
			title: "A",
			numberOverride: "M1",
		});
		restoreTaskFieldMutation(snapshot, "A", "numberOverride")?.(current);
		expect(current.tasksById.A.numberOverride).toBeUndefined();
	});

	it("trims padded keys on restore", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
			numberOverride: "  M1.A  ",
		});
		const current = build({
			id: "A",
			kind: "task",
			title: "A",
		});
		restoreTaskFieldMutation(snapshot, "A", "numberOverride")?.(current);
		expect(current.tasksById.A.numberOverride).toBe("M1.A");
	});

	it("restores progress=0 (falsy but valid)", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
			progress: 0,
		});
		const current = build({
			id: "A",
			kind: "task",
			title: "A",
			progress: 50,
		});
		restoreTaskFieldMutation(snapshot, "A", "progress")?.(current);
		expect(current.tasksById.A.progress).toBe(0);
	});
});

describe("restoreAllTaskFieldsMutation", () => {
	it("applies multiple field restores in one mutation", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "Alpha",
			estimate: est(1, 2, 3),
		});
		const current = build({
			id: "A",
			kind: "milestone",
			title: "Renamed",
			groupId: "P",
		});
		const mut = restoreAllTaskFieldsMutation(snapshot, "A", [
			"title",
			"kind",
			"groupId",
			"estimate",
		]);
		mut?.(current);
		expect(current.tasksById.A.title).toBe("Alpha");
		expect(current.tasksById.A.kind).toBe("task");
		expect(current.tasksById.A.groupId).toBeNull();
		expect(current.tasksById.A.estimate).toEqual(est(1, 2, 3));
	});

	it("returns null with no fields", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "A",
		});
		expect(restoreAllTaskFieldsMutation(snapshot, "A", [])).toBeNull();
	});
});

describe("reAddTaskMutation / dropTaskMutation", () => {
	it("re-adds a deleted task from snapshot, no-op if already present", () => {
		const snapshot = build({
			id: "A",
			kind: "task",
			title: "Recover",
			estimate: est(1, 2, 3),
		});
		const current = build();
		reAddTaskMutation(snapshot, "A")?.(current);
		expect(current.tasksById.A.title).toBe("Recover");
		// Mutate snapshot to confirm clones are deep-copied.
		snapshot.tasksById.A.title = "Mutated snapshot";
		expect(current.tasksById.A.title).toBe("Recover");

		// Re-applying is a no-op (doesn't stomp current edits).
		current.tasksById.A.title = "Edited again";
		reAddTaskMutation(snapshot, "A")?.(current);
		expect(current.tasksById.A.title).toBe("Edited again");
	});

	it("dropTaskMutation removes the task and any deps touching it", () => {
		const current = build(
			{ id: "A", kind: "task", title: "A" },
			{ id: "B", kind: "task", title: "B" },
		);
		current.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		dropTaskMutation("A")(current);
		expect(current.tasksById.A).toBeUndefined();
		expect(current.dependenciesById.ab).toBeUndefined();
		expect(current.tasksById.B).toBeDefined();
	});
});

describe("restoreDependencyMutation", () => {
	it("restores a deleted dependency from snapshot", () => {
		const snapshot = build();
		snapshot.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		const current = build();
		restoreDependencyMutation(snapshot, "ab")?.(current);
		expect(current.dependenciesById.ab.from.taskId).toBe("A");
	});

	it("drops a dependency that wasn't in the snapshot", () => {
		const snapshot = build();
		const current = build();
		current.dependenciesById.ab = {
			id: "ab",
			from: { taskId: "A" },
			to: { taskId: "B" },
			type: "finish_to_start",
		};
		restoreDependencyMutation(snapshot, "ab")?.(current);
		expect(current.dependenciesById.ab).toBeUndefined();
	});
});

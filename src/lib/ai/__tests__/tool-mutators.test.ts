import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addDependencyMutation,
	addTaskMutation,
	moveTaskMutation,
	newId,
	removeDependencyMutation,
	removeTaskMutation,
	setActualDatesMutation,
	setDependencyMutation,
	setEstimateMutation,
	setKeyMutation,
	setKindMutation,
	setNotesMutation,
	setProgressMutation,
	setStatusMutation,
	setTitleMutation,
	summarizeProject,
} from "#/lib/ai/tool-mutators";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";

// todayIsoDate() reads `new Date()` — freezing the clock at a known UTC
// instant makes the auto-stamped started/finished dates deterministic.
function freezeClockAtMay25() {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));
}

function seed(): PertDoc {
	const d = createEmptyPertDoc("Test");
	addTaskMutation(d, { title: "A" }, "task_a");
	addTaskMutation(d, { title: "B" }, "task_b");
	return d;
}

describe("addTaskMutation", () => {
	it("creates a task with the default 1/2/4 day estimate", () => {
		const d = createEmptyPertDoc("p");
		const res = addTaskMutation(d, { title: "Spike" }, "task_x");
		expect(res.id).toBe("task_x");
		expect(d.tasksById.task_x.title).toBe("Spike");
		expect(d.tasksById.task_x.estimate).toEqual({
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 4,
			unit: "day",
		});
	});

	it("does not assign an estimate to milestones", () => {
		const d = createEmptyPertDoc("p");
		addTaskMutation(d, { title: "Launch", kind: "milestone" }, "task_l");
		expect(d.tasksById.task_l.estimate).toBeUndefined();
	});

	it("honors an explicit estimate", () => {
		const d = createEmptyPertDoc("p");
		addTaskMutation(
			d,
			{
				title: "Spike",
				estimate: {
					optimistic: 2,
					mostLikely: 3,
					pessimistic: 5,
					unit: "hour",
				},
			},
			"task_x",
		);
		expect(d.tasksById.task_x.estimate?.unit).toBe("hour");
	});
});

describe("setEstimateMutation", () => {
	it("returns an error when the task does not exist", () => {
		const d = seed();
		expect(
			setEstimateMutation(d, {
				taskId: "nope",
				optimistic: 1,
				mostLikely: 2,
				pessimistic: 3,
			}),
		).toEqual({ ok: false, error: "task nope not found" });
	});

	it("rejects optimistic > mostLikely", () => {
		const d = seed();
		expect(
			setEstimateMutation(d, {
				taskId: "task_a",
				optimistic: 5,
				mostLikely: 2,
				pessimistic: 3,
			}),
		).toEqual({ ok: false, error: "optimistic must be <= mostLikely" });
	});

	it("inherits the existing unit when not provided", () => {
		const d = seed();
		d.tasksById.task_a.estimate = {
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 4,
			unit: "hour",
		};
		setEstimateMutation(d, {
			taskId: "task_a",
			optimistic: 2,
			mostLikely: 4,
			pessimistic: 8,
		});
		expect(d.tasksById.task_a.estimate?.unit).toBe("hour");
	});
});

describe("setTitleMutation", () => {
	it("renames a task", () => {
		const d = seed();
		setTitleMutation(d, { taskId: "task_a", title: "Renamed" });
		expect(d.tasksById.task_a.title).toBe("Renamed");
	});
});

describe("addDependencyMutation", () => {
	it("creates an edge with finish_to_start as the default", () => {
		const d = seed();
		const res = addDependencyMutation(
			d,
			{ fromTaskId: "task_a", toTaskId: "task_b" },
			"dep_1",
		);
		expect(res).toEqual({ id: "dep_1" });
		expect(d.dependenciesById.dep_1.type).toBe("finish_to_start");
		expect(d.dependenciesById.dep_1.from).toEqual({
			taskId: "task_a",
			port: "finish",
		});
		expect(d.dependenciesById.dep_1.to).toEqual({
			taskId: "task_b",
			port: "start",
		});
	});

	it("deduplicates rather than creating a parallel edge", () => {
		const d = seed();
		addDependencyMutation(
			d,
			{ fromTaskId: "task_a", toTaskId: "task_b" },
			"dep_1",
		);
		const again = addDependencyMutation(
			d,
			{ fromTaskId: "task_a", toTaskId: "task_b" },
			"dep_2",
		);
		expect(again).toEqual({ id: "dep_1" });
		expect(Object.keys(d.dependenciesById)).toEqual(["dep_1"]);
	});

	it("rejects self-dependencies", () => {
		const d = seed();
		expect(
			addDependencyMutation(d, { fromTaskId: "task_a", toTaskId: "task_a" }),
		).toEqual({ ok: false, error: "self-dependency is not allowed" });
	});

	it("rejects missing endpoints", () => {
		const d = seed();
		expect(
			addDependencyMutation(d, { fromTaskId: "ghost", toTaskId: "task_a" }),
		).toEqual({ ok: false, error: "task ghost not found" });
	});
});

describe("removeTaskMutation", () => {
	it("removes the task and all touching edges", () => {
		const d = seed();
		addDependencyMutation(
			d,
			{ fromTaskId: "task_a", toTaskId: "task_b" },
			"dep_1",
		);
		removeTaskMutation(d, { taskId: "task_a" });
		expect(d.tasksById.task_a).toBeUndefined();
		expect(d.dependenciesById.dep_1).toBeUndefined();
	});

	it("promotes children to top-level rather than cascading", () => {
		const d = seed();
		addTaskMutation(d, { title: "Child", parentId: "task_a" }, "task_child");
		removeTaskMutation(d, { taskId: "task_a" });
		expect(d.tasksById.task_child.parentId).toBeNull();
	});
});

describe("removeDependencyMutation", () => {
	it("returns an error when the dep does not exist", () => {
		const d = seed();
		expect(removeDependencyMutation(d, { dependencyId: "x" })).toEqual({
			ok: false,
			error: "dependency x not found",
		});
	});
});

describe("summarizeProject", () => {
	it("returns flat lists matching the doc", () => {
		const d = seed();
		addDependencyMutation(
			d,
			{ fromTaskId: "task_a", toTaskId: "task_b" },
			"dep_1",
		);
		const summary = summarizeProject(d);
		expect(summary.title).toBe("Test");
		expect(summary.tasks.map((t) => t.id).sort()).toEqual(["task_a", "task_b"]);
		expect(summary.dependencies).toEqual([
			{
				id: "dep_1",
				fromTaskId: "task_a",
				toTaskId: "task_b",
				type: "finish_to_start",
			},
		]);
	});
});

describe("newId", () => {
	it("produces unique prefixed ids", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) ids.add(newId("task"));
		expect(ids.size).toBe(100);
		for (const id of ids) expect(id.startsWith("task_")).toBe(true);
	});
});

describe("setKindMutation", () => {
	it("drops the estimate when becoming a milestone", () => {
		const d = seed();
		setKindMutation(d, { taskId: "task_a", kind: "milestone" });
		expect(d.tasksById.task_a.kind).toBe("milestone");
		expect(d.tasksById.task_a.estimate).toBeUndefined();
	});

	it("adds a default estimate when becoming a task", () => {
		const d = seed();
		setKindMutation(d, { taskId: "task_a", kind: "milestone" });
		setKindMutation(d, { taskId: "task_a", kind: "task" });
		expect(d.tasksById.task_a.estimate).toEqual({
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 4,
			unit: "day",
		});
	});

	it("errors on unknown task", () => {
		const d = seed();
		expect(setKindMutation(d, { taskId: "ghost", kind: "task" })).toEqual({
			ok: false,
			error: "task ghost not found",
		});
	});
});

describe("setKeyMutation", () => {
	it("sets and trims the key", () => {
		const d = seed();
		setKeyMutation(d, { taskId: "task_a", key: "  M1.A  " });
		expect(d.tasksById.task_a.key).toBe("M1.A");
	});

	it("clears the key on empty string", () => {
		const d = seed();
		d.tasksById.task_a.key = "M1";
		setKeyMutation(d, { taskId: "task_a", key: "" });
		expect(d.tasksById.task_a.key).toBeUndefined();
	});

	it("clears the key on null", () => {
		const d = seed();
		d.tasksById.task_a.key = "M1";
		setKeyMutation(d, { taskId: "task_a", key: null });
		expect(d.tasksById.task_a.key).toBeUndefined();
	});
});

describe("setNotesMutation", () => {
	it("sets notes verbatim (no trim)", () => {
		const d = seed();
		setNotesMutation(d, { taskId: "task_a", notes: "  hello  " });
		expect(d.tasksById.task_a.notes).toBe("  hello  ");
	});

	it("clears on null", () => {
		const d = seed();
		d.tasksById.task_a.notes = "x";
		setNotesMutation(d, { taskId: "task_a", notes: null });
		expect(d.tasksById.task_a.notes).toBeUndefined();
	});
});

describe("moveTaskMutation", () => {
	function withContainer(): PertDoc {
		const d = seed();
		addTaskMutation(d, { title: "C", kind: "container" }, "task_c");
		return d;
	}

	it("reparents a task into a container", () => {
		const d = withContainer();
		const res = moveTaskMutation(d, {
			taskId: "task_a",
			parentId: "task_c",
		});
		expect(res).toEqual({ ok: true });
		expect(d.tasksById.task_a.parentId).toBe("task_c");
	});

	it("promotes to top level on parentId=null", () => {
		const d = withContainer();
		d.tasksById.task_a.parentId = "task_c";
		moveTaskMutation(d, { taskId: "task_a", parentId: null });
		expect(d.tasksById.task_a.parentId).toBeNull();
	});

	it("is a no-op when parentId already matches", () => {
		const d = withContainer();
		expect(moveTaskMutation(d, { taskId: "task_a", parentId: null })).toEqual({
			ok: true,
		});
	});

	it("rejects moving into a non-container", () => {
		const d = withContainer();
		expect(
			moveTaskMutation(d, { taskId: "task_a", parentId: "task_b" }),
		).toEqual({ ok: false, error: "task task_b is not a container" });
	});

	it("rejects unknown container", () => {
		const d = withContainer();
		expect(
			moveTaskMutation(d, { taskId: "task_a", parentId: "ghost" }),
		).toEqual({ ok: false, error: "container ghost not found" });
	});

	it("rejects a move that would create a hierarchy cycle", () => {
		const d = seed();
		addTaskMutation(d, { title: "Outer", kind: "container" }, "task_outer");
		addTaskMutation(
			d,
			{ title: "Inner", kind: "container", parentId: "task_outer" },
			"task_inner",
		);
		expect(
			moveTaskMutation(d, {
				taskId: "task_outer",
				parentId: "task_inner",
			}),
		).toEqual({
			ok: false,
			error: "move would create a cycle in the hierarchy",
		});
	});
});

describe("setStatusMutation", () => {
	beforeEach(() => {
		freezeClockAtMay25();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("in_progress stamps actualStart and ensures progress=0", () => {
		const d = seed();
		setStatusMutation(d, { taskId: "task_a", status: "in_progress" });
		expect(d.tasksById.task_a.status).toBe("in_progress");
		expect(d.tasksById.task_a.actualStart).toBe("2026-05-25");
		expect(d.tasksById.task_a.progress).toBe(0);
		expect(d.tasksById.task_a.actualFinish).toBeUndefined();
	});

	it("in_progress preserves existing progress", () => {
		const d = seed();
		d.tasksById.task_a.progress = 42;
		setStatusMutation(d, { taskId: "task_a", status: "in_progress" });
		expect(d.tasksById.task_a.progress).toBe(42);
	});

	it("completed sets progress=100 and stamps both dates", () => {
		const d = seed();
		setStatusMutation(d, { taskId: "task_a", status: "completed" });
		expect(d.tasksById.task_a.status).toBe("completed");
		expect(d.tasksById.task_a.progress).toBe(100);
		expect(d.tasksById.task_a.actualStart).toBe("2026-05-25");
		expect(d.tasksById.task_a.actualFinish).toBe("2026-05-25");
	});

	it("not_started clears progress and actual dates", () => {
		const d = seed();
		d.tasksById.task_a.progress = 50;
		d.tasksById.task_a.actualStart = "2026-04-01";
		d.tasksById.task_a.actualFinish = "2026-04-10";
		setStatusMutation(d, { taskId: "task_a", status: "not_started" });
		expect(d.tasksById.task_a.progress).toBeUndefined();
		expect(d.tasksById.task_a.actualStart).toBeUndefined();
		expect(d.tasksById.task_a.actualFinish).toBeUndefined();
	});

	it("preserves an existing actualStart when re-entering in_progress", () => {
		const d = seed();
		d.tasksById.task_a.actualStart = "2026-04-01";
		setStatusMutation(d, { taskId: "task_a", status: "in_progress" });
		expect(d.tasksById.task_a.actualStart).toBe("2026-04-01");
	});
});

describe("setProgressMutation", () => {
	beforeEach(() => {
		freezeClockAtMay25();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("clamps progress to 0..100 and rounds", () => {
		const d = seed();
		setProgressMutation(d, { taskId: "task_a", progress: 150 });
		expect(d.tasksById.task_a.progress).toBe(100);
		setProgressMutation(d, { taskId: "task_a", progress: -10 });
		expect(d.tasksById.task_a.progress).toBe(0);
		setProgressMutation(d, { taskId: "task_a", progress: 33.6 });
		expect(d.tasksById.task_a.progress).toBe(34);
	});

	it("flips to in_progress and stamps actualStart when leaving 0", () => {
		const d = seed();
		setProgressMutation(d, { taskId: "task_a", progress: 25 });
		expect(d.tasksById.task_a.status).toBe("in_progress");
		expect(d.tasksById.task_a.actualStart).toBe("2026-05-25");
	});

	it("flips to completed and stamps actualFinish at 100", () => {
		const d = seed();
		setProgressMutation(d, { taskId: "task_a", progress: 100 });
		expect(d.tasksById.task_a.status).toBe("completed");
		expect(d.tasksById.task_a.actualFinish).toBe("2026-05-25");
	});

	it("rolls back from completed when progress drops below 100", () => {
		const d = seed();
		d.tasksById.task_a.status = "completed";
		d.tasksById.task_a.actualFinish = "2026-05-01";
		setProgressMutation(d, { taskId: "task_a", progress: 80 });
		expect(d.tasksById.task_a.status).toBe("in_progress");
		expect(d.tasksById.task_a.actualFinish).toBeUndefined();
	});
});

describe("setActualDatesMutation", () => {
	it("sets both dates without touching status", () => {
		const d = seed();
		const res = setActualDatesMutation(d, {
			taskId: "task_a",
			actualStart: "2026-01-01",
			actualFinish: "2026-01-05",
		});
		expect(res).toEqual({ ok: true });
		expect(d.tasksById.task_a.actualStart).toBe("2026-01-01");
		expect(d.tasksById.task_a.actualFinish).toBe("2026-01-05");
		expect(d.tasksById.task_a.status).toBeUndefined();
	});

	it("only touches fields that are explicitly provided", () => {
		const d = seed();
		d.tasksById.task_a.actualStart = "2026-01-01";
		d.tasksById.task_a.actualFinish = "2026-01-05";
		setActualDatesMutation(d, {
			taskId: "task_a",
			actualFinish: "2026-02-01",
		});
		expect(d.tasksById.task_a.actualStart).toBe("2026-01-01");
		expect(d.tasksById.task_a.actualFinish).toBe("2026-02-01");
	});

	it("clears a date when null or empty string is provided", () => {
		const d = seed();
		d.tasksById.task_a.actualStart = "2026-01-01";
		d.tasksById.task_a.actualFinish = "2026-01-05";
		setActualDatesMutation(d, {
			taskId: "task_a",
			actualStart: null,
			actualFinish: "",
		});
		expect(d.tasksById.task_a.actualStart).toBeUndefined();
		expect(d.tasksById.task_a.actualFinish).toBeUndefined();
	});

	it("rejects malformed dates", () => {
		const d = seed();
		expect(
			setActualDatesMutation(d, {
				taskId: "task_a",
				actualStart: "yesterday",
			}),
		).toEqual({ ok: false, error: "actualStart must be ISO yyyy-mm-dd" });
	});
});

describe("setDependencyMutation", () => {
	function withDep(): PertDoc {
		const d = seed();
		addDependencyMutation(
			d,
			{ fromTaskId: "task_a", toTaskId: "task_b" },
			"dep_1",
		);
		return d;
	}

	it("updates type and lag in one call", () => {
		const d = withDep();
		setDependencyMutation(d, {
			dependencyId: "dep_1",
			type: "start_to_start",
			lagDays: 3,
		});
		expect(d.dependenciesById.dep_1.type).toBe("start_to_start");
		expect(d.dependenciesById.dep_1.lagDays).toBe(3);
	});

	it("only changes the fields provided", () => {
		const d = withDep();
		d.dependenciesById.dep_1.lagDays = 2;
		setDependencyMutation(d, {
			dependencyId: "dep_1",
			type: "finish_to_finish",
		});
		expect(d.dependenciesById.dep_1.type).toBe("finish_to_finish");
		expect(d.dependenciesById.dep_1.lagDays).toBe(2);
	});

	it("clears lag when null is passed", () => {
		const d = withDep();
		d.dependenciesById.dep_1.lagDays = 2;
		setDependencyMutation(d, { dependencyId: "dep_1", lagDays: null });
		expect(d.dependenciesById.dep_1.lagDays).toBeUndefined();
	});

	it("errors on unknown dependency", () => {
		const d = withDep();
		expect(
			setDependencyMutation(d, {
				dependencyId: "ghost",
				type: "start_to_start",
			}),
		).toEqual({ ok: false, error: "dependency ghost not found" });
	});
});

describe("summarizeProject (extended fields)", () => {
	it("surfaces key, status, progress, notes, actual dates, and lag", () => {
		const d = seed();
		d.tasksById.task_a.key = "M1.A";
		d.tasksById.task_a.status = "in_progress";
		d.tasksById.task_a.progress = 40;
		d.tasksById.task_a.notes = "watch out for X";
		d.tasksById.task_a.actualStart = "2026-04-01";
		addDependencyMutation(
			d,
			{ fromTaskId: "task_a", toTaskId: "task_b" },
			"dep_1",
		);
		d.dependenciesById.dep_1.lagDays = 5;
		const summary = summarizeProject(d);
		const a = summary.tasks.find((t) => t.id === "task_a");
		expect(a?.key).toBe("M1.A");
		expect(a?.status).toBe("in_progress");
		expect(a?.progress).toBe(40);
		expect(a?.notes).toBe("watch out for X");
		expect(a?.actualStart).toBe("2026-04-01");
		expect(summary.dependencies[0].lagDays).toBe(5);
	});
});

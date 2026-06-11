import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addDependencyMutation,
	addTaskMutation,
	assignTaskToGroupMutation,
	createGroupMutation,
	deleteGroupMutation,
	newId,
	removeDependencyMutation,
	removeTaskMutation,
	renameGroupMutation,
	setActualDatesMutation,
	setDependencyMutation,
	setEstimateMutation,
	setGroupParentMutation,
	setIssueLinksMutation,
	setKindMutation,
	setNotesMutation,
	setProgressMutation,
	setStatusMutation,
	setTaskNumberMutation,
	setTitleMutation,
	summarizeProject,
} from "#/lib/ai/tool-mutators";
import { computeNumbering } from "#/lib/pert/numbering";
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
		expect(res).toEqual({ id: "task_x" });
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

	it("assigns a task to an existing group", () => {
		const d = createEmptyPertDoc("p");
		const g = createGroupMutation(d, { name: "Backend", id: "grp_1" });
		expect(g).toEqual({ ok: true, id: "grp_1" });
		const res = addTaskMutation(d, { title: "Leaf", groupId: "grp_1" }, "t1");
		expect(res).toEqual({ id: "t1" });
		expect(d.tasksById.t1.groupId).toBe("grp_1");
	});

	it("rejects an id that already exists instead of overwriting", () => {
		const d = createEmptyPertDoc("p");
		addTaskMutation(d, { title: "First" }, "dup");
		const res = addTaskMutation(d, { title: "Second" }, "dup");
		expect(res).toEqual({ ok: false, error: "task id dup already exists" });
		// The original task is untouched.
		expect(d.tasksById.dup.title).toBe("First");
	});

	it("rejects a groupId that doesn't exist", () => {
		const d = createEmptyPertDoc("p");
		const res = addTaskMutation(d, { title: "Orphan", groupId: "ghost" }, "t1");
		expect(res).toEqual({ ok: false, error: "group ghost not found" });
		expect(d.tasksById.t1).toBeUndefined();
	});

	it("accepts a groupId listed in pendingGroupIds (forward reference)", () => {
		const d = createEmptyPertDoc("p");
		const res = addTaskMutation(
			d,
			{ title: "Child", groupId: "future_group" },
			"t1",
			{ pendingGroupIds: new Set(["future_group"]) },
		);
		expect(res).toEqual({ id: "t1" });
		expect(d.tasksById.t1.groupId).toBe("future_group");
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

	it("errors on unknown task", () => {
		const d = seed();
		expect(removeTaskMutation(d, { taskId: "ghost" })).toEqual({
			ok: false,
			error: "task ghost not found",
		});
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

	it("surfaces groups with their derived WBS numbers", () => {
		const d = createEmptyPertDoc("Test");
		createGroupMutation(d, { name: "Backend", id: "grp_1" });
		createGroupMutation(d, {
			name: "API",
			parentGroupId: "grp_1",
			id: "grp_2",
		});
		addTaskMutation(d, { title: "Leaf", groupId: "grp_2" }, "task_a");
		const summary = summarizeProject(d);
		const g1 = summary.groups.find((g) => g.id === "grp_1");
		const g2 = summary.groups.find((g) => g.id === "grp_2");
		expect(g1).toEqual({
			id: "grp_1",
			name: "Backend",
			parentGroupId: null,
			number: "1",
		});
		expect(g2).toEqual({
			id: "grp_2",
			name: "API",
			parentGroupId: "grp_1",
			number: "1.1",
		});
		const a = summary.tasks.find((t) => t.id === "task_a");
		expect(a?.groupId).toBe("grp_2");
		expect(a?.number).toBe("1.1.1");
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

describe("setIssueLinksMutation", () => {
	it("sets a trimmed, deduped list", () => {
		const d = seed();
		setIssueLinksMutation(d, {
			taskId: "task_a",
			issueKeys: ["  PROJ-1 ", "PROJ-2", "PROJ-1", ""],
		});
		expect(d.tasksById.task_a.issueKeys).toEqual(["PROJ-1", "PROJ-2"]);
	});

	it("clears on null", () => {
		const d = seed();
		d.tasksById.task_a.issueKeys = ["PROJ-1"];
		setIssueLinksMutation(d, { taskId: "task_a", issueKeys: null });
		expect(d.tasksById.task_a.issueKeys).toBeUndefined();
	});

	it("clears when every key is blank", () => {
		const d = seed();
		d.tasksById.task_a.issueKeys = ["PROJ-1"];
		setIssueLinksMutation(d, { taskId: "task_a", issueKeys: ["  ", ""] });
		expect(d.tasksById.task_a.issueKeys).toBeUndefined();
	});

	it("errors on a missing task", () => {
		const d = seed();
		const r = setIssueLinksMutation(d, {
			taskId: "nope",
			issueKeys: ["PROJ-1"],
		});
		expect(r).toEqual({ ok: false, error: "task nope not found" });
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
	it("surfaces number override, status, progress, notes, actual dates, and lag", () => {
		const d = seed();
		d.tasksById.task_a.numberOverride = "M1.A";
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
		// An override wins over the derived number in the summary.
		expect(a?.number).toBe("M1.A");
		expect(a?.status).toBe("in_progress");
		expect(a?.progress).toBe(40);
		expect(a?.notes).toBe("watch out for X");
		expect(a?.actualStart).toBe("2026-04-01");
		expect(summary.dependencies[0].lagDays).toBe(5);
	});
});

describe("group mutators", () => {
	function withGroups(): PertDoc {
		const d = createEmptyPertDoc("p");
		createGroupMutation(d, { name: "Backend", id: "g1" });
		createGroupMutation(d, { name: "Frontend", id: "g2" });
		return d;
	}

	describe("createGroupMutation", () => {
		it("assigns sibling order and returns the id", () => {
			const d = createEmptyPertDoc("p");
			const first = createGroupMutation(d, { name: "One", id: "g1" });
			const second = createGroupMutation(d, { name: "Two", id: "g2" });
			expect(first).toEqual({ ok: true, id: "g1" });
			expect(second).toEqual({ ok: true, id: "g2" });
			expect(d.groupsById.g1.order).toBe(0);
			expect(d.groupsById.g2.order).toBe(1);
			expect(d.groupsById.g1.parentGroupId).toBeNull();
		});

		it("generates an id when none is given", () => {
			const d = createEmptyPertDoc("p");
			const res = createGroupMutation(d, { name: "Auto" });
			expect(res.ok).toBe(true);
			if (res.ok) {
				expect(res.id.startsWith("grp_")).toBe(true);
				expect(d.groupsById[res.id].name).toBe("Auto");
			}
		});

		it("nests under an existing parent group", () => {
			const d = withGroups();
			const res = createGroupMutation(d, {
				name: "API",
				parentGroupId: "g1",
				id: "g1a",
			});
			expect(res).toEqual({ ok: true, id: "g1a" });
			expect(d.groupsById.g1a.parentGroupId).toBe("g1");
		});

		it("rejects an unknown parent group", () => {
			const d = createEmptyPertDoc("p");
			expect(
				createGroupMutation(d, { name: "Orphan", parentGroupId: "ghost" }),
			).toEqual({ ok: false, error: "parent group ghost not found" });
		});
	});

	describe("renameGroupMutation", () => {
		it("renames and trims", () => {
			const d = withGroups();
			expect(
				renameGroupMutation(d, { groupId: "g1", name: "  Core  " }),
			).toEqual({ ok: true });
			expect(d.groupsById.g1.name).toBe("Core");
		});

		it("errors on unknown group", () => {
			const d = withGroups();
			expect(renameGroupMutation(d, { groupId: "ghost", name: "x" })).toEqual({
				ok: false,
				error: "group ghost not found",
			});
		});
	});

	describe("setGroupParentMutation", () => {
		it("re-parents a group under another", () => {
			const d = withGroups();
			expect(
				setGroupParentMutation(d, { groupId: "g2", parentGroupId: "g1" }),
			).toEqual({ ok: true });
			expect(d.groupsById.g2.parentGroupId).toBe("g1");
		});

		it("promotes a group to root with parentGroupId=null", () => {
			const d = withGroups();
			setGroupParentMutation(d, { groupId: "g2", parentGroupId: "g1" });
			setGroupParentMutation(d, { groupId: "g2", parentGroupId: null });
			expect(d.groupsById.g2.parentGroupId).toBeNull();
		});

		it("rejects a move that would create a group cycle", () => {
			const d = withGroups();
			// g2 becomes a child of g1…
			setGroupParentMutation(d, { groupId: "g2", parentGroupId: "g1" });
			// …so moving g1 under g2 would close a cycle.
			expect(
				setGroupParentMutation(d, { groupId: "g1", parentGroupId: "g2" }),
			).toEqual({ ok: false, error: "would create a group cycle" });
			// The doc is untouched.
			expect(d.groupsById.g1.parentGroupId).toBeNull();
		});
	});

	describe("deleteGroupMutation", () => {
		it("promotes member tasks to the parent group and re-parents child groups to the grandparent", () => {
			const d = createEmptyPertDoc("p");
			createGroupMutation(d, { name: "Parent", id: "P" });
			createGroupMutation(d, { name: "Child", parentGroupId: "P", id: "C" });
			createGroupMutation(d, {
				name: "Grandchild",
				parentGroupId: "C",
				id: "GC",
			});
			addTaskMutation(d, { title: "Member", groupId: "C" }, "t_member");

			const res = deleteGroupMutation(d, { groupId: "C" });
			expect(res).toEqual({ ok: true, promotedTasks: 1, promotedGroups: 1 });
			// The group is gone…
			expect(d.groupsById.C).toBeUndefined();
			// …but its member task survives, promoted to the parent group.
			expect(d.tasksById.t_member).toBeDefined();
			expect(d.tasksById.t_member.groupId).toBe("P");
			// …and its child group survives, re-parented to the grandparent.
			expect(d.groupsById.GC).toBeDefined();
			expect(d.groupsById.GC.parentGroupId).toBe("P");
		});

		it("ungroups member tasks when a root group is deleted", () => {
			const d = createEmptyPertDoc("p");
			createGroupMutation(d, { name: "Root", id: "R" });
			addTaskMutation(d, { title: "Member", groupId: "R" }, "t_member");
			const res = deleteGroupMutation(d, { groupId: "R" });
			expect(res).toEqual({ ok: true, promotedTasks: 1, promotedGroups: 0 });
			expect(d.tasksById.t_member).toBeDefined();
			expect(d.tasksById.t_member.groupId).toBeNull();
		});

		it("errors on unknown group", () => {
			const d = withGroups();
			expect(deleteGroupMutation(d, { groupId: "ghost" })).toEqual({
				ok: false,
				error: "group ghost not found",
			});
		});
	});

	describe("assignTaskToGroupMutation", () => {
		it("assigns and clears a task's group", () => {
			const d = withGroups();
			addTaskMutation(d, { title: "T" }, "t1");
			expect(
				assignTaskToGroupMutation(d, { taskId: "t1", groupId: "g1" }),
			).toEqual({ ok: true });
			expect(d.tasksById.t1.groupId).toBe("g1");
			assignTaskToGroupMutation(d, { taskId: "t1", groupId: null });
			expect(d.tasksById.t1.groupId).toBeNull();
		});

		it("rejects an unknown group", () => {
			const d = withGroups();
			addTaskMutation(d, { title: "T" }, "t1");
			expect(
				assignTaskToGroupMutation(d, { taskId: "t1", groupId: "ghost" }),
			).toEqual({ ok: false, error: "group ghost not found" });
		});
	});

	describe("setTaskNumberMutation", () => {
		it("sets and clears the number override", () => {
			const d = seed();
			expect(
				setTaskNumberMutation(d, { taskId: "task_a", number: "  M1.A  " }),
			).toEqual({ ok: true });
			expect(d.tasksById.task_a.numberOverride).toBe("M1.A");
			setTaskNumberMutation(d, { taskId: "task_a", number: null });
			expect(d.tasksById.task_a.numberOverride).toBeUndefined();
		});

		it("clears the override on empty string", () => {
			const d = seed();
			d.tasksById.task_a.numberOverride = "X";
			setTaskNumberMutation(d, { taskId: "task_a", number: "" });
			expect(d.tasksById.task_a.numberOverride).toBeUndefined();
		});
	});

	// Headline: moving a task between groups recomputes its derived number,
	// unless the task pins a manual override.
	describe("derived numbering follows group moves", () => {
		it("a task with no override gets a different derived number after a move", () => {
			const d = withGroups(); // g1 → "1", g2 → "2"
			addTaskMutation(d, { title: "T" }, "t1");
			assignTaskToGroupMutation(d, { taskId: "t1", groupId: "g1" });
			const before = computeNumbering(d).tasks.t1;
			assignTaskToGroupMutation(d, { taskId: "t1", groupId: "g2" });
			const after = computeNumbering(d).tasks.t1;
			expect(before).toBe("1.1");
			expect(after).toBe("2.1");
			expect(after).not.toBe(before);
		});

		it("a task WITH an override keeps its number across a move", () => {
			const d = withGroups();
			addTaskMutation(d, { title: "T" }, "t1");
			assignTaskToGroupMutation(d, { taskId: "t1", groupId: "g1" });
			setTaskNumberMutation(d, { taskId: "t1", number: "PINNED" });
			const before = computeNumbering(d).tasks.t1;
			assignTaskToGroupMutation(d, { taskId: "t1", groupId: "g2" });
			const after = computeNumbering(d).tasks.t1;
			expect(before).toBe("PINNED");
			expect(after).toBe("PINNED");
		});
	});
});

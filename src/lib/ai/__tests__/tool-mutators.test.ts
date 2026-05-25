import { describe, expect, it } from "vitest";
import {
	addDependencyMutation,
	addTaskMutation,
	newId,
	removeDependencyMutation,
	removeTaskMutation,
	setEstimateMutation,
	setTitleMutation,
	summarizeProject,
} from "#/lib/ai/tool-mutators";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";

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

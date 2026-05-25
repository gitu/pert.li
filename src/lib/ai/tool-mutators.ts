import type {
	Dependency,
	DependencyType,
	Estimate,
	EstimateUnit,
	PertDoc,
	Task,
	TaskId,
	TaskKind,
} from "#/lib/pert/types";

// Pure mutators for the chat-tool implementations. Each one takes a draft
// `PertDoc` (the parameter passed by Automerge `change()`) plus typed args,
// applies the edit in place, and returns a small JSON-friendly result.
//
// Keeping these separate from the tool definitions means we can unit-test
// them on a synthetic doc without spinning up Automerge or React, and the
// client glue stays a one-liner.

export function newId(prefix: string): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `${prefix}_${s}`;
}

export type AddTaskArgs = {
	title: string;
	kind?: TaskKind;
	parentId?: TaskId | null;
	estimate?: Estimate;
};

export function addTaskMutation(
	d: PertDoc,
	args: AddTaskArgs,
	id: TaskId = newId("task"),
): { id: TaskId } {
	const kind: TaskKind = args.kind ?? "task";
	const base: Task = {
		id,
		kind,
		title: args.title,
		parentId: args.parentId ?? null,
	};
	if (kind === "task") {
		base.estimate = args.estimate ?? {
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 4,
			unit: "day",
		};
	} else if (args.estimate) {
		base.estimate = args.estimate;
	}
	d.tasksById[id] = base;
	return { id };
}

export type SetEstimateArgs = {
	taskId: TaskId;
	optimistic: number;
	mostLikely: number;
	pessimistic: number;
	unit?: EstimateUnit;
};

export function setEstimateMutation(
	d: PertDoc,
	args: SetEstimateArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	if (args.optimistic > args.mostLikely)
		return { ok: false, error: "optimistic must be <= mostLikely" };
	if (args.mostLikely > args.pessimistic)
		return { ok: false, error: "mostLikely must be <= pessimistic" };
	task.estimate = {
		optimistic: args.optimistic,
		mostLikely: args.mostLikely,
		pessimistic: args.pessimistic,
		unit: args.unit ?? task.estimate?.unit ?? "day",
	};
	return { ok: true };
}

export type SetTitleArgs = { taskId: TaskId; title: string };

export function setTitleMutation(
	d: PertDoc,
	args: SetTitleArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	task.title = args.title;
	return { ok: true };
}

export type AddDependencyArgs = {
	fromTaskId: TaskId;
	toTaskId: TaskId;
	type?: DependencyType;
};

export function addDependencyMutation(
	d: PertDoc,
	args: AddDependencyArgs,
	id = newId("dep"),
): { id: string } | { ok: false; error: string } {
	if (!d.tasksById[args.fromTaskId])
		return { ok: false, error: `task ${args.fromTaskId} not found` };
	if (!d.tasksById[args.toTaskId])
		return { ok: false, error: `task ${args.toTaskId} not found` };
	if (args.fromTaskId === args.toTaskId)
		return { ok: false, error: "self-dependency is not allowed" };
	for (const dep of Object.values(d.dependenciesById)) {
		if (
			dep.from.taskId === args.fromTaskId &&
			dep.to.taskId === args.toTaskId
		) {
			return { id: dep.id };
		}
	}
	const dep: Dependency = {
		id,
		from: { taskId: args.fromTaskId, port: "finish" },
		to: { taskId: args.toTaskId, port: "start" },
		type: args.type ?? "finish_to_start",
	};
	d.dependenciesById[id] = dep;
	return { id };
}

export type RemoveDependencyArgs = { dependencyId: string };

export function removeDependencyMutation(
	d: PertDoc,
	args: RemoveDependencyArgs,
): { ok: true } | { ok: false; error: string } {
	if (!d.dependenciesById[args.dependencyId])
		return { ok: false, error: `dependency ${args.dependencyId} not found` };
	delete d.dependenciesById[args.dependencyId];
	return { ok: true };
}

export type RemoveTaskArgs = { taskId: TaskId };

export function removeTaskMutation(
	d: PertDoc,
	args: RemoveTaskArgs,
): { ok: true } | { ok: false; error: string } {
	if (!d.tasksById[args.taskId])
		return { ok: false, error: `task ${args.taskId} not found` };
	delete d.tasksById[args.taskId];
	for (const [depId, dep] of Object.entries(d.dependenciesById)) {
		if (dep.from.taskId === args.taskId || dep.to.taskId === args.taskId) {
			delete d.dependenciesById[depId];
		}
	}
	for (const t of Object.values(d.tasksById)) {
		if (t.parentId === args.taskId) t.parentId = null;
	}
	return { ok: true };
}

// Read-only summary used by the model to inspect the current graph.
// Strips Automerge proxy magic and large fields (positions, metadata) the
// model never needs to plan.
export type ProjectSummary = {
	title: string;
	tasks: Array<{
		id: TaskId;
		title: string;
		kind: TaskKind;
		parentId: TaskId | null;
		estimate?: Estimate;
	}>;
	dependencies: Array<{
		id: string;
		fromTaskId: TaskId | null;
		toTaskId: TaskId | null;
		type: DependencyType;
	}>;
};

export function summarizeProject(doc: PertDoc): ProjectSummary {
	return {
		title: doc.title,
		tasks: Object.values(doc.tasksById).map((t) => ({
			id: t.id,
			title: t.title,
			kind: t.kind,
			parentId: t.parentId,
			estimate: t.estimate
				? {
						optimistic: t.estimate.optimistic,
						mostLikely: t.estimate.mostLikely,
						pessimistic: t.estimate.pessimistic,
						unit: t.estimate.unit,
					}
				: undefined,
		})),
		dependencies: Object.values(doc.dependenciesById).map((d) => ({
			id: d.id,
			fromTaskId: d.from.taskId ?? null,
			toTaskId: d.to.taskId ?? null,
			type: d.type,
		})),
	};
}

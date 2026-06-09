import { todayIsoDate } from "#/lib/pert/calendar";
import { computeNumbering } from "#/lib/pert/numbering";
import type {
	Dependency,
	DependencyType,
	DocumentId,
	Estimate,
	EstimateUnit,
	GroupId,
	PertDoc,
	ProjectDocumentKind,
	Task,
	TaskId,
	TaskKind,
	TaskStatus,
} from "#/lib/pert/types";

// Group mutators live in the pure engine; re-export them here so the chat
// client glue and tests have a single import surface for "tool mutators".
export {
	assignTaskToGroupMutation,
	type CreateGroupArgs,
	createGroupMutation,
	deleteGroupMutation,
	renameGroupMutation,
	setGroupParentMutation,
	setTaskNumberMutation,
} from "#/lib/pert/group-mutations";

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
	groupId?: GroupId | null;
	estimate?: Estimate;
};

export type AddTaskOptions = {
	// Group ids an enclosing batch will create before it finishes (see
	// applyOperations). `groupId` may forward-reference one of them — the AI
	// often emits a group's tasks before (or after) the group itself in the
	// same propose_changes batch.
	pendingGroupIds?: ReadonlySet<string>;
};

export function addTaskMutation(
	d: PertDoc,
	args: AddTaskArgs,
	id: TaskId = newId("task"),
	opts: AddTaskOptions = {},
): { id: TaskId } | { ok: false; error: string } {
	// Never overwrite an existing task. Client-provided ids collide when two
	// independent proposals (e.g. two imports staged at the same time) both
	// pick generic ids like "phase_1" — silently replacing the first task's
	// content was how multi-import corruption happened.
	if (d.tasksById[id]) {
		return { ok: false, error: `task id ${id} already exists` };
	}
	// A dangling groupId would render the task as ungrouped; reject unknown
	// groups here rather than letting them in silently.
	const groupId = args.groupId ?? null;
	if (
		groupId !== null &&
		!d.groupsById[groupId] &&
		!opts.pendingGroupIds?.has(groupId)
	) {
		return { ok: false, error: `group ${groupId} not found` };
	}
	const kind: TaskKind = args.kind ?? "task";
	const base: Task = {
		id,
		kind,
		title: args.title,
	};
	if (groupId !== null) base.groupId = groupId;
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
	const fromTask = d.tasksById[args.fromTaskId];
	const toTask = d.tasksById[args.toTaskId];
	if (!fromTask)
		return { ok: false, error: `task ${args.fromTaskId} not found` };
	if (!toTask) return { ok: false, error: `task ${args.toTaskId} not found` };
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
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	delete d.tasksById[args.taskId];
	for (const [depId, dep] of Object.entries(d.dependenciesById)) {
		if (dep.from.taskId === args.taskId || dep.to.taskId === args.taskId) {
			delete d.dependenciesById[depId];
		}
	}
	return { ok: true };
}

// ── Editable-field mutators ────────────────────────────────────────────────
//
// Each one mirrors the corresponding inspector control so the model can drive
// the same behaviours a human user would (including side-effects like
// auto-stamping started/finished dates when status flips).

export type SetKindArgs = { taskId: TaskId; kind: TaskKind };

export function setKindMutation(
	d: PertDoc,
	args: SetKindArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	task.kind = args.kind;
	if (args.kind === "milestone") delete task.estimate;
	if (args.kind === "task" && !task.estimate) {
		task.estimate = {
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 4,
			unit: "day",
		};
	}
	return { ok: true };
}

export type SetNotesArgs = { taskId: TaskId; notes: string | null };

export function setNotesMutation(
	d: PertDoc,
	args: SetNotesArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	if (args.notes === null || args.notes === "") delete task.notes;
	else task.notes = args.notes;
	return { ok: true };
}

export type SetIssueLinksArgs = { taskId: TaskId; issueKeys: string[] | null };

// Replace a task's external issue references with the given list. Whole-list
// semantics (like set_notes' replace) — the caller passes the complete desired
// set. Keys are trimmed, empties dropped, duplicates removed; an empty result
// clears the field (delete, never assign undefined — Automerge rejects it).
export function setIssueLinksMutation(
	d: PertDoc,
	args: SetIssueLinksArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const cleaned = (args.issueKeys ?? [])
		.map((k) => k.trim())
		.filter((k) => k.length > 0);
	const deduped = [...new Set(cleaned)];
	if (deduped.length === 0) delete task.issueKeys;
	else task.issueKeys = deduped;
	return { ok: true };
}

export type SetStatusArgs = { taskId: TaskId; status: TaskStatus };

// Mirrors the inspector's setStatus behaviour: when the user marks something
// in_progress or completed, the started / finished dates are stamped and
// progress snaps to 0 / 100 so the engine has consistent values.
export function setStatusMutation(
	d: PertDoc,
	args: SetStatusArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const today = todayIsoDate();
	task.status = args.status;
	if (args.status === "not_started") {
		delete task.progress;
		delete task.actualStart;
		delete task.actualFinish;
	} else if (args.status === "in_progress") {
		if (typeof task.progress !== "number") task.progress = 0;
		if (!task.actualStart) task.actualStart = today;
		delete task.actualFinish;
	} else if (args.status === "completed") {
		task.progress = 100;
		if (!task.actualStart) task.actualStart = today;
		task.actualFinish = today;
	}
	return { ok: true };
}

export type SetProgressArgs = { taskId: TaskId; progress: number };

export function setProgressMutation(
	d: PertDoc,
	args: SetProgressArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const today = todayIsoDate();
	const clamped = Math.max(0, Math.min(100, Math.round(args.progress)));
	task.progress = clamped;
	if (task.status !== "in_progress" && task.status !== "completed") {
		task.status = "in_progress";
		if (!task.actualStart) task.actualStart = today;
	}
	if (clamped >= 100) {
		task.status = "completed";
		task.actualFinish = today;
	} else if (task.status === "completed") {
		task.status = "in_progress";
		delete task.actualFinish;
	}
	return { ok: true };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SetActualDatesArgs = {
	taskId: TaskId;
	actualStart?: string | null;
	actualFinish?: string | null;
};

export function setActualDatesMutation(
	d: PertDoc,
	args: SetActualDatesArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	if (args.actualStart !== undefined) {
		if (args.actualStart === null || args.actualStart === "") {
			delete task.actualStart;
		} else if (!ISO_DATE.test(args.actualStart)) {
			return {
				ok: false,
				error: "actualStart must be ISO yyyy-mm-dd",
			};
		} else {
			task.actualStart = args.actualStart;
		}
	}
	if (args.actualFinish !== undefined) {
		if (args.actualFinish === null || args.actualFinish === "") {
			delete task.actualFinish;
		} else if (!ISO_DATE.test(args.actualFinish)) {
			return {
				ok: false,
				error: "actualFinish must be ISO yyyy-mm-dd",
			};
		} else {
			task.actualFinish = args.actualFinish;
		}
	}
	return { ok: true };
}

export type SetDependencyArgs = {
	dependencyId: string;
	type?: DependencyType;
	lagDays?: number | null;
};

export function setDependencyMutation(
	d: PertDoc,
	args: SetDependencyArgs,
): { ok: true } | { ok: false; error: string } {
	const dep = d.dependenciesById[args.dependencyId];
	if (!dep)
		return { ok: false, error: `dependency ${args.dependencyId} not found` };
	if (args.type !== undefined) dep.type = args.type;
	if (args.lagDays !== undefined) {
		if (args.lagDays === null) delete dep.lagDays;
		else dep.lagDays = args.lagDays;
	}
	return { ok: true };
}

// Read-only summary used by the model to inspect the current graph.
// Strips Automerge proxy magic and large fields (positions, metadata) the
// model never needs to plan.
export type ProjectSummary = {
	title: string;
	groups: Array<{
		id: GroupId;
		name: string;
		parentGroupId: GroupId | null;
		number: string;
	}>;
	tasks: Array<{
		id: TaskId;
		title: string;
		kind: TaskKind;
		groupId: GroupId | null;
		// Derived WBS number (or the override when set).
		number: string;
		estimate?: Estimate;
		status?: TaskStatus;
		progress?: number;
		notes?: string;
		actualStart?: string;
		actualFinish?: string;
	}>;
	dependencies: Array<{
		id: string;
		fromTaskId: TaskId | null;
		toTaskId: TaskId | null;
		type: DependencyType;
		lagDays?: number;
	}>;
	// Manifest of attached source documents — name/kind/size only, never the
	// full text (that would blow up every project read). The model calls
	// `read_document` when it needs a document's contents.
	attachedDocuments: DocumentManifestEntry[];
};

export type DocumentManifestEntry = {
	id: DocumentId;
	name: string;
	kind: ProjectDocumentKind;
	pages?: number;
	truncated: boolean;
	charCount: number;
};

// Read-only: list the project's attached documents as a manifest (no text).
export function listDocuments(doc: PertDoc): {
	documents: DocumentManifestEntry[];
} {
	const byId = doc.documentsById ?? {};
	return {
		documents: Object.values(byId).map((d) => ({
			id: d.id,
			name: d.name,
			kind: d.kind,
			pages: d.pages,
			truncated: d.truncated,
			charCount: d.text.length,
		})),
	};
}

export type ReadDocumentResult =
	| {
			ok: true;
			id: DocumentId;
			name: string;
			kind: ProjectDocumentKind;
			pages?: number;
			truncated: boolean;
			text: string;
	  }
	| { ok: false; error: string };

// Read-only: return the full extracted text of one attached document by id.
export function readDocument(
	doc: PertDoc,
	args: { documentId: DocumentId },
): ReadDocumentResult {
	const found = doc.documentsById?.[args.documentId];
	if (!found) {
		return { ok: false, error: `No document with id "${args.documentId}"` };
	}
	return {
		ok: true,
		id: found.id,
		name: found.name,
		kind: found.kind,
		pages: found.pages,
		truncated: found.truncated,
		text: found.text,
	};
}

export function summarizeProject(doc: PertDoc): ProjectSummary {
	const numbers = computeNumbering(doc);
	return {
		title: doc.title,
		groups: Object.values(doc.groupsById).map((g) => ({
			id: g.id,
			name: g.name,
			parentGroupId: g.parentGroupId ?? null,
			number: numbers.groups[g.id] ?? "",
		})),
		tasks: Object.values(doc.tasksById).map((t) => ({
			id: t.id,
			title: t.title,
			kind: t.kind,
			groupId: t.groupId ?? null,
			number: numbers.tasks[t.id] ?? "",
			estimate: t.estimate
				? {
						optimistic: t.estimate.optimistic,
						mostLikely: t.estimate.mostLikely,
						pessimistic: t.estimate.pessimistic,
						unit: t.estimate.unit,
					}
				: undefined,
			status: t.status,
			progress: t.progress,
			notes: t.notes,
			actualStart: t.actualStart,
			actualFinish: t.actualFinish,
		})),
		dependencies: Object.values(doc.dependenciesById).map((d) => ({
			id: d.id,
			fromTaskId: d.from.taskId ?? null,
			toTaskId: d.to.taskId ?? null,
			type: d.type,
			lagDays: d.lagDays,
		})),
		attachedDocuments: listDocuments(doc).documents,
	};
}

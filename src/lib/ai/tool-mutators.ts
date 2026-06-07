import { todayIsoDate } from "#/lib/pert/calendar";
import {
	createDefaultInterface,
	ensureContainerInterfaces,
	newInterfaceId,
	removeContainerInterfaces,
} from "#/lib/pert/interfaces";
import { canReparent } from "#/lib/pert/reparent";
import type {
	ContainerInterface,
	Dependency,
	DependencyType,
	DocumentId,
	Estimate,
	EstimateUnit,
	InterfaceId,
	InterfaceKind,
	PertDoc,
	ProjectDocumentKind,
	Task,
	TaskId,
	TaskKind,
	TaskStatus,
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

export type AddTaskOptions = {
	// Ids an enclosing batch will create before it finishes (see
	// applyOperations). parentId may forward-reference one of them — the AI
	// often emits children before their parent container in the same
	// propose_changes batch.
	pendingContainerIds?: ReadonlySet<string>;
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
	// A dangling parentId makes the task invisible on the nested canvas (the
	// layout only walks parents that exist), so reject unknown parents here
	// rather than letting them in silently.
	const parentId = args.parentId ?? null;
	if (parentId !== null) {
		const parent = d.tasksById[parentId];
		if (parent) {
			if (parent.kind !== "container") {
				return {
					ok: false,
					error: `parent ${parentId} is not a container`,
				};
			}
		} else if (!opts.pendingContainerIds?.has(parentId)) {
			return {
				ok: false,
				error: `parent container ${parentId} not found`,
			};
		}
	}
	const kind: TaskKind = args.kind ?? "task";
	const base: Task = {
		id,
		kind,
		title: args.title,
		parentId,
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
	if (kind === "container") ensureContainerInterfaces(d, id);
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
	// Dependencies must reference leaf tasks/milestones, not containers.
	// Container-to-container edges are inferred by the projection from
	// leaf-to-leaf edges, so storing a direct container endpoint would
	// duplicate intent and confuse the projection's rerouting logic.
	if (fromTask.kind === "container")
		return {
			ok: false,
			error: `cannot depend from container ${args.fromTaskId} — pick a specific leaf inside it`,
		};
	if (toTask.kind === "container")
		return {
			ok: false,
			error: `cannot depend on container ${args.toTaskId} — pick a specific leaf inside it`,
		};
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
	const wasContainer = task.kind === "container";
	delete d.tasksById[args.taskId];
	for (const [depId, dep] of Object.entries(d.dependenciesById)) {
		if (dep.from.taskId === args.taskId || dep.to.taskId === args.taskId) {
			delete d.dependenciesById[depId];
		}
	}
	for (const t of Object.values(d.tasksById)) {
		if (t.parentId === args.taskId) t.parentId = null;
	}
	if (wasContainer) removeContainerInterfaces(d, args.taskId);
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
	const previousKind = task.kind;
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
	if (args.kind === "container" && previousKind !== "container") {
		ensureContainerInterfaces(d, args.taskId);
	} else if (args.kind !== "container" && previousKind === "container") {
		removeContainerInterfaces(d, args.taskId);
	}
	return { ok: true };
}

export type SetKeyArgs = { taskId: TaskId; key: string | null };

export function setKeyMutation(
	d: PertDoc,
	args: SetKeyArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const trimmed = args.key?.trim() ?? "";
	if (trimmed.length === 0) delete task.key;
	else task.key = trimmed;
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

export type MoveTaskArgs = { taskId: TaskId; parentId: TaskId | null };

export function moveTaskMutation(
	d: PertDoc,
	args: MoveTaskArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const current = task.parentId ?? null;
	if (current === args.parentId) return { ok: true };
	if (args.parentId !== null) {
		const target = d.tasksById[args.parentId];
		if (!target)
			return { ok: false, error: `container ${args.parentId} not found` };
		if (target.kind !== "container")
			return {
				ok: false,
				error: `task ${args.parentId} is not a container`,
			};
		if (!canReparent(d, args.taskId, args.parentId))
			return {
				ok: false,
				error:
					"move would create a cycle in the hierarchy — a container cannot be moved into its own descendant. Check the parent/child direction: the CHILD's parentId points at the CONTAINER, never the other way around.",
			};
	}
	task.parentId = args.parentId;
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

export type AddInterfaceArgs = {
	containerId: TaskId;
	kind: InterfaceKind;
	label?: string;
	taskRef?: TaskId | null;
};

export function addInterfaceMutation(
	d: PertDoc,
	args: AddInterfaceArgs,
	id: InterfaceId = newInterfaceId(),
): { id: InterfaceId } | { ok: false; error: string } {
	const container = d.tasksById[args.containerId];
	if (!container)
		return { ok: false, error: `task ${args.containerId} not found` };
	if (container.kind !== "container")
		return {
			ok: false,
			error: `task ${args.containerId} is not a container`,
		};
	if (args.taskRef && !d.tasksById[args.taskRef])
		return { ok: false, error: `task ${args.taskRef} not found` };
	if (!d.interfacesByContainerId[args.containerId]) {
		d.interfacesByContainerId[args.containerId] = {};
	}
	const iface: ContainerInterface = {
		...createDefaultInterface(args.containerId, args.kind, id),
	};
	if (args.label) iface.label = args.label;
	if (args.taskRef) iface.taskRef = args.taskRef;
	d.interfacesByContainerId[args.containerId][id] = iface;
	return { id };
}

export type RemoveInterfaceArgs = {
	containerId: TaskId;
	interfaceId: InterfaceId;
};

export function removeInterfaceMutation(
	d: PertDoc,
	args: RemoveInterfaceArgs,
): { ok: true } | { ok: false; error: string } {
	const bucket = d.interfacesByContainerId[args.containerId];
	if (!bucket?.[args.interfaceId])
		return {
			ok: false,
			error: `interface ${args.interfaceId} not found on ${args.containerId}`,
		};
	delete bucket[args.interfaceId];
	return { ok: true };
}

export type SetInterfaceArgs = {
	containerId: TaskId;
	interfaceId: InterfaceId;
	label?: string;
	taskRef?: TaskId | null;
};

export function setInterfaceMutation(
	d: PertDoc,
	args: SetInterfaceArgs,
): { ok: true } | { ok: false; error: string } {
	const iface = d.interfacesByContainerId[args.containerId]?.[args.interfaceId];
	if (!iface)
		return {
			ok: false,
			error: `interface ${args.interfaceId} not found on ${args.containerId}`,
		};
	if (args.label !== undefined) iface.label = args.label;
	if (args.taskRef !== undefined) {
		if (args.taskRef === null) {
			delete iface.taskRef;
		} else {
			if (!d.tasksById[args.taskRef])
				return { ok: false, error: `task ${args.taskRef} not found` };
			iface.taskRef = args.taskRef;
		}
	}
	return { ok: true };
}

export type PinDependencyArgs = {
	dependencyId: string;
	side: "from" | "to";
	interfaceId: InterfaceId | null;
};

// Sets or clears the `interfaceId` hint on one side of an existing dependency.
// The dep's canonical `taskId` endpoint is unchanged — the interfaceId is the
// hint the projection uses to decide which port handle a collapsed edge
// attaches to. Passing null clears the hint.
export function pinDependencyMutation(
	d: PertDoc,
	args: PinDependencyArgs,
): { ok: true } | { ok: false; error: string } {
	const dep = d.dependenciesById[args.dependencyId];
	if (!dep)
		return { ok: false, error: `dependency ${args.dependencyId} not found` };
	const endpoint = args.side === "from" ? dep.from : dep.to;
	if (args.interfaceId === null) {
		delete endpoint.interfaceId;
		return { ok: true };
	}
	// Verify the interface exists somewhere in the doc before pinning.
	let found = false;
	for (const bucket of Object.values(d.interfacesByContainerId)) {
		if (bucket[args.interfaceId]) {
			found = true;
			break;
		}
	}
	if (!found)
		return {
			ok: false,
			error: `interface ${args.interfaceId} not found`,
		};
	endpoint.interfaceId = args.interfaceId;
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
	tasks: Array<{
		id: TaskId;
		title: string;
		kind: TaskKind;
		parentId: TaskId | null;
		key?: string;
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
		fromInterfaceId?: InterfaceId;
		toInterfaceId?: InterfaceId;
	}>;
	interfaces: Array<{
		id: InterfaceId;
		containerId: TaskId;
		kind: InterfaceKind;
		label: string;
		taskRef?: TaskId;
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
	const interfaces: ProjectSummary["interfaces"] = [];
	for (const bucket of Object.values(doc.interfacesByContainerId)) {
		for (const iface of Object.values(bucket)) {
			interfaces.push({
				id: iface.id,
				containerId: iface.containerId,
				kind: iface.kind,
				label: iface.label,
				taskRef: iface.taskRef,
			});
		}
	}
	return {
		title: doc.title,
		tasks: Object.values(doc.tasksById).map((t) => ({
			id: t.id,
			title: t.title,
			kind: t.kind,
			parentId: t.parentId,
			key: t.key,
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
			fromInterfaceId: d.from.interfaceId,
			toInterfaceId: d.to.interfaceId,
		})),
		interfaces,
		attachedDocuments: listDocuments(doc).documents,
	};
}

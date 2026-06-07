import type { Dependency, DependencyId, PertDoc, Task, TaskId } from "./types";

// Targeted restore mutations: each one re-writes a single field (or a single
// dependency) on the current doc using the value taken from a snapshot. We
// never wholesale replace `tasksById` — concurrent edits the user *does*
// want to keep would be wiped out.

export type RestoreableField =
	| "title"
	| "kind"
	| "groupId"
	| "numberOverride"
	| "estimate"
	| "notes"
	| "status"
	| "progress"
	| "actualStart"
	| "actualFinish";

export function restoreTaskFieldMutation(
	snapshot: PertDoc,
	taskId: TaskId,
	field: RestoreableField,
): ((doc: PertDoc) => void) | null {
	const source = snapshot.tasksById[taskId];
	if (!source) return null;
	return (doc) => {
		const draft = doc.tasksById[taskId];
		if (!draft) return;
		applyField(draft, source, field);
	};
}

export function restoreAllTaskFieldsMutation(
	snapshot: PertDoc,
	taskId: TaskId,
	fields: RestoreableField[],
): ((doc: PertDoc) => void) | null {
	const source = snapshot.tasksById[taskId];
	if (!source || fields.length === 0) return null;
	return (doc) => {
		const draft = doc.tasksById[taskId];
		if (!draft) return;
		for (const f of fields) applyField(draft, source, f);
	};
}

// Bring back a task that was deleted since the snapshot. Layout position is
// inherited from snapshot if present, otherwise left undefined so the
// auto-layout will re-place it.
export function reAddTaskMutation(
	snapshot: PertDoc,
	taskId: TaskId,
): ((doc: PertDoc) => void) | null {
	const source = snapshot.tasksById[taskId];
	if (!source) return null;
	const cloned: Task = structuredClone(source);
	return (doc) => {
		if (doc.tasksById[taskId]) return;
		doc.tasksById[taskId] = cloned;
	};
}

export function dropTaskMutation(taskId: TaskId): (doc: PertDoc) => void {
	return (doc) => {
		delete doc.tasksById[taskId];
		for (const [depId, dep] of Object.entries(doc.dependenciesById)) {
			if (dep.from.taskId === taskId || dep.to.taskId === taskId) {
				delete doc.dependenciesById[depId];
			}
		}
	};
}

export function restoreDependencyMutation(
	snapshot: PertDoc,
	depId: DependencyId,
): ((doc: PertDoc) => void) | null {
	const source = snapshot.dependenciesById[depId];
	if (source) {
		const cloned: Dependency = structuredClone(source);
		return (doc) => {
			doc.dependenciesById[depId] = cloned;
		};
	}
	// Absent in snapshot → restoring means deleting it on current.
	return (doc) => {
		delete doc.dependenciesById[depId];
	};
}

function applyField(draft: Task, source: Task, field: RestoreableField): void {
	switch (field) {
		case "title":
			draft.title = source.title;
			return;
		case "kind":
			draft.kind = source.kind;
			return;
		case "groupId":
			draft.groupId = source.groupId ?? null;
			return;
		case "numberOverride": {
			// Mirror setTaskNumberMutation's normalisation: whitespace-only or
			// empty overrides clear, so restoring a snapshot doesn't reintroduce
			// a noise override the live editor would have removed.
			const trimmed = source.numberOverride?.trim() ?? "";
			if (trimmed.length === 0) delete draft.numberOverride;
			else draft.numberOverride = trimmed;
			return;
		}
		case "estimate":
			if (source.estimate) draft.estimate = structuredClone(source.estimate);
			else delete draft.estimate;
			return;
		case "notes":
			if (source.notes) draft.notes = source.notes;
			else delete draft.notes;
			return;
		case "status":
			if (source.status) draft.status = source.status;
			else delete draft.status;
			return;
		case "progress":
			if (typeof source.progress === "number") draft.progress = source.progress;
			else delete draft.progress;
			return;
		case "actualStart":
			if (source.actualStart) draft.actualStart = source.actualStart;
			else delete draft.actualStart;
			return;
		case "actualFinish":
			if (source.actualFinish) draft.actualFinish = source.actualFinish;
			else delete draft.actualFinish;
			return;
	}
}

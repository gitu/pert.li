import type { DocHandle } from "@automerge/automerge-repo";
import { Store } from "@tanstack/store";
import type { PertDoc, TaskId } from "./types";

// Single source of truth for what's selected on the active canvas. Lives
// outside the Automerge doc because selection is per-user, per-tab — sharing
// it across collaborators belongs to Phase 7 (Presence).
//
// `projectId` is the project route param, not the Automerge URL. It lets the
// inspector ignore stale selections when the user navigates to a different
// project.

export type SelectionState = {
	projectId: string | null;
	taskId: TaskId | null;
};

export const selectionStore = new Store<SelectionState>({
	projectId: null,
	taskId: null,
});

export function selectTask(projectId: string, taskId: TaskId | null) {
	selectionStore.setState((s) =>
		s.projectId === projectId && s.taskId === taskId
			? s
			: { projectId, taskId },
	);
}

export function clearSelectionFor(projectId: string) {
	selectionStore.setState((s) =>
		s.projectId === projectId ? { projectId, taskId: null } : s,
	);
}

// Lifts the active project doc + mutator above the route tree so panes that
// live in the parent app shell (right inspector, bottom history drawer) can
// read and edit without a context provider snaking down through children.
// Cleared when the project route unmounts.
export type ChangeFn = (mutate: (doc: PertDoc) => void) => void;

export type ProjectDocState = {
	projectId: string | null;
	doc: PertDoc | null;
	changeDoc: ChangeFn | null;
	// The DocHandle is lifted too so panes outside the project route (history
	// drawer, presence overlays) can subscribe to ephemeral messages and
	// derive presence without an extra route hop.
	handle: DocHandle<PertDoc> | null;
};

export const projectDocStore = new Store<ProjectDocState>({
	projectId: null,
	doc: null,
	changeDoc: null,
	handle: null,
});

// `changeDoc` is nullable so callers can shove the doc into the store in
// read-only mode (mobile-readonly view mode). Every downstream consumer
// already gates inline edit affordances on `!changeDoc`, so passing null
// gives them the read-only UI for free without per-component changes.
export function setActiveProjectDoc(
	projectId: string,
	doc: PertDoc,
	changeDoc: ChangeFn | null,
	handle: DocHandle<PertDoc> | null,
) {
	projectDocStore.setState((s) => {
		if (
			s.projectId === projectId &&
			s.doc === doc &&
			s.changeDoc === changeDoc &&
			s.handle === handle
		) {
			return s;
		}
		return { projectId, doc, changeDoc, handle };
	});
}

export function clearActiveProjectDoc(projectId: string) {
	projectDocStore.setState((s) =>
		s.projectId === projectId
			? { projectId: null, doc: null, changeDoc: null, handle: null }
			: s,
	);
}

// Task IDs this client created — via direct UI edits OR applied AI proposals,
// both of which run through `changeDoc`. Used by the canvas to decide whether
// to pan the camera onto a freshly-appeared task: we only follow our own (and
// the AI's) additions, never a remote collaborator's, whose changes arrive
// through Automerge sync and never touch `changeDoc`. Without this, every peer's
// viewport jumps to wherever someone else just added a node.
const locallyCreatedTaskIds = new Set<TaskId>();

export function noteLocallyCreated(ids: Iterable<TaskId>) {
	for (const id of ids) locallyCreatedTaskIds.add(id);
}

// Returns true if `id` was a local creation, removing it so the set doesn't
// grow unboundedly. Each newly-appeared task is checked exactly once.
export function consumeLocallyCreated(id: TaskId): boolean {
	return locallyCreatedTaskIds.delete(id);
}

export function clearLocallyCreated() {
	locallyCreatedTaskIds.clear();
}

// Wraps a `changeDoc` so that any task added to `tasksById` during the mutation
// is recorded as locally originated. The diff happens inside the single
// Automerge `change` callback, so it's synchronous and exact — keys present
// after the mutator ran but not before are new this call.
export function withLocalOriginTracking(changeDoc: ChangeFn): ChangeFn {
	return (mutate) => {
		changeDoc((d) => {
			const before = new Set(Object.keys(d.tasksById));
			mutate(d);
			// Diff the full key set rather than comparing counts: a single
			// mutation can add one task and remove another (e.g. an AI proposal
			// that replaces a node), leaving the count unchanged while still
			// introducing a genuinely new id we must record.
			const added: TaskId[] = [];
			for (const id of Object.keys(d.tasksById)) {
				if (!before.has(id)) added.push(id as TaskId);
			}
			if (added.length > 0) noteLocallyCreated(added);
		});
	};
}

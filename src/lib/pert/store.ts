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

export function setActiveProjectDoc(
	projectId: string,
	doc: PertDoc,
	changeDoc: ChangeFn,
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

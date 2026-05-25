import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useMemo } from "react";
import type { TaskId } from "./types";

// Per-project, per-user, per-tab collapse state. Kept in localStorage so the
// choice survives a reload but isn't synced across devices — that lives in
// the workspace doc once Phase 7 (presence + per-user state sync) lands.
// Trade-off chosen here because canvas collapse is genuinely ephemeral UX
// and storing it in Automerge would add merge surface for no real benefit
// before workspace-doc sync exists.

const STORAGE_KEY = "pertli.collapsed";

type StoredShape = Record<string, string[]>;

type CollapseState = {
	byProject: Record<string, ReadonlySet<TaskId>>;
};

function readStored(): StoredShape {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed as StoredShape;
	} catch {
		// ignore — corrupted entry, treat as empty
	}
	return {};
}

function hydrate(stored: StoredShape): CollapseState {
	const out: CollapseState = { byProject: {} };
	for (const [projectId, ids] of Object.entries(stored)) {
		if (Array.isArray(ids)) out.byProject[projectId] = new Set(ids);
	}
	return out;
}

function persist(state: CollapseState) {
	if (typeof window === "undefined") return;
	const stored: StoredShape = {};
	for (const [projectId, set] of Object.entries(state.byProject)) {
		if (set.size > 0) stored[projectId] = [...set];
	}
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// ignore — quota or private mode
	}
}

export const collapseStore = new Store<CollapseState>(hydrate(readStored()));

export function isCollapsed(projectId: string, taskId: TaskId): boolean {
	return collapseStore.state.byProject[projectId]?.has(taskId) ?? false;
}

export function toggleCollapse(projectId: string, taskId: TaskId) {
	collapseStore.setState((s) => {
		const prev = s.byProject[projectId] ?? new Set<TaskId>();
		const next = new Set(prev);
		if (next.has(taskId)) next.delete(taskId);
		else next.add(taskId);
		const updated: CollapseState = {
			byProject: { ...s.byProject, [projectId]: next },
		};
		persist(updated);
		return updated;
	});
}

export function setCollapsed(
	projectId: string,
	taskId: TaskId,
	collapsed: boolean,
) {
	collapseStore.setState((s) => {
		const prev = s.byProject[projectId] ?? new Set<TaskId>();
		if (prev.has(taskId) === collapsed) return s;
		const next = new Set(prev);
		if (collapsed) next.add(taskId);
		else next.delete(taskId);
		const updated: CollapseState = {
			byProject: { ...s.byProject, [projectId]: next },
		};
		persist(updated);
		return updated;
	});
}

export function clearProjectCollapse(projectId: string) {
	collapseStore.setState((s) => {
		if (!s.byProject[projectId]) return s;
		const next = { ...s.byProject };
		delete next[projectId];
		const updated: CollapseState = { byProject: next };
		persist(updated);
		return updated;
	});
}

// React hook returning the live collapsed set for a project. Identity
// changes only when the set itself does, so consumers can `useMemo` on it.
export function useCollapsedSet(projectId: string): ReadonlySet<TaskId> {
	const raw = useStore(collapseStore, (s) => s.byProject[projectId]);
	return useMemo(() => raw ?? EMPTY_SET, [raw]);
}

const EMPTY_SET: ReadonlySet<TaskId> = new Set();

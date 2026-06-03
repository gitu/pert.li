// Local-first queue of projects created while offline (or before the server
// round-trip completes). Each record owns a client-created Automerge doc whose
// URL is already live in the browser repo; reconcile-pending.ts later registers
// the row server-side so it joins the user's workspace and syncs.
//
// Backed by idb-keyval (survives reloads) with an in-memory mirror so React can
// read it synchronously via useSyncExternalStore. SSR-safe: all IndexedDB
// access is guarded on `typeof indexedDB`.

import type { AutomergeUrl } from "@automerge/automerge-repo";
import { del, get, set } from "idb-keyval";
import { useEffect, useSyncExternalStore } from "react";
import type { SyncFailureKind } from "./retry";

export type PendingStatus =
	| "pending" // created locally, awaiting registration
	| "registering" // a registration attempt is in flight
	| "registered" // server row exists; doc is syncing
	| "error"; // gave up auto-retry; needs manual retry/discard

export type PendingProject = {
	localId: string; // uuid; doubles as the route projectId until registered
	title: string;
	workspaceId?: string; // unknown offline → server lands it in personal ws
	automergeDocUrl: AutomergeUrl;
	createdAt: string; // ISO
	status: PendingStatus;
	serverId?: string; // canonical project id once registered
	attempts: number;
	lastError?: string;
	lastErrorKind?: SyncFailureKind;
	nextRetryAt?: number; // epoch ms; gates the next auto-retry
};

const IDB_KEY = "pert.li:pending-projects";

let memory: Record<string, PendingProject> = {};
let snapshot: PendingProject[] = [];
let hydrated = false;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function rebuildSnapshot() {
	snapshot = Object.values(memory).sort((a, b) =>
		a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
	);
}

function emit() {
	for (const l of listeners) l();
}

async function persist() {
	if (typeof indexedDB === "undefined") return;
	try {
		await set(IDB_KEY, memory);
	} catch {
		// A failed persist is non-fatal — the in-memory copy still drives the UI
		// for this session; we just lose reload-durability for this write.
	}
}

// Hydrate the in-memory mirror from IndexedDB exactly once. Safe to await
// repeatedly. On the server it resolves immediately with an empty store.
export function hydratePending(): Promise<void> {
	if (hydrated) return Promise.resolve();
	if (hydration) return hydration;
	if (typeof indexedDB === "undefined") {
		hydrated = true;
		return Promise.resolve();
	}
	hydration = get<Record<string, PendingProject>>(IDB_KEY)
		.then((stored) => {
			if (stored) {
				memory = stored;
				rebuildSnapshot();
			}
		})
		.catch(() => {
			// Treat a read failure as an empty queue rather than blocking boot.
		})
		.finally(() => {
			hydrated = true;
			emit();
		});
	return hydration;
}

export function isHydrated(): boolean {
	return hydrated;
}

export function getPendingSnapshot(): PendingProject[] {
	return snapshot;
}

export function getPending(localId: string): PendingProject | undefined {
	return memory[localId];
}

// Resolve a route projectId (which may be a localId, a serverId, or a server
// project that was never local) to its pending record, if any. Used by
// useProjectDoc to short-circuit the server lookup for offline-created docs.
export function findPendingByProjectId(
	projectId: string,
): PendingProject | undefined {
	const direct = memory[projectId];
	if (direct) return direct;
	for (const rec of Object.values(memory)) {
		if (rec.serverId === projectId) return rec;
	}
	return undefined;
}

export function subscribePending(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export async function addPending(
	record: Omit<PendingProject, "attempts" | "status"> &
		Partial<Pick<PendingProject, "attempts" | "status">>,
): Promise<PendingProject> {
	const full: PendingProject = {
		attempts: 0,
		status: "pending",
		...record,
	};
	memory = { ...memory, [full.localId]: full };
	rebuildSnapshot();
	emit();
	await persist();
	return full;
}

export async function updatePending(
	localId: string,
	patch: Partial<PendingProject>,
): Promise<PendingProject | undefined> {
	const existing = memory[localId];
	if (!existing) return undefined;
	const next = { ...existing, ...patch };
	memory = { ...memory, [localId]: next };
	rebuildSnapshot();
	emit();
	await persist();
	return next;
}

export async function removePending(localId: string): Promise<void> {
	if (!(localId in memory)) return;
	const { [localId]: _removed, ...rest } = memory;
	memory = rest;
	rebuildSnapshot();
	emit();
	await persist();
}

// Wipe the queue (in-memory + IndexedDB). Used by sign-out teardown so a
// shared device doesn't leave the next user with the previous user's queued
// project metadata.
export async function clearPending(): Promise<void> {
	memory = {};
	rebuildSnapshot();
	emit();
	if (typeof indexedDB === "undefined") return;
	try {
		await del(IDB_KEY);
	} catch {
		// Best-effort.
	}
}

// React binding. Returns the full queue; callers filter by status as needed.
// Kicks off (idempotent) hydration so the queue is loaded from IndexedDB even
// when the first subscriber is the home/sidebar list or SyncStatus — not just
// a project route. Without this, an offline reload onto the home page would
// show an empty list until a project route happened to mount.
export function usePendingProjects(): PendingProject[] {
	useEffect(() => {
		void hydratePending();
	}, []);
	return useSyncExternalStore(
		subscribePending,
		getPendingSnapshot,
		getPendingSnapshot,
	);
}

// Test-only: reset module state between cases.
export function __resetPendingForTests() {
	memory = {};
	snapshot = [];
	hydrated = false;
	hydration = null;
	listeners.clear();
}

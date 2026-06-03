// Drains the offline-created project queue (pending-projects.ts) once the user
// is back online with a live session: registers each client-created Automerge
// doc as a server project row, then lets the repo's WebSocket adapter sync the
// doc body. Failures are classified and either auto-retried with backoff,
// paused (auth), or parked in a manual-only error state (terminal) — never
// silently dropped (CLAUDE.md "no silent caps").

import type { ProjectSummary } from "#/types/workspace";
import type { PendingProject } from "./pending-projects";
import {
	getPendingSnapshot,
	hydratePending,
	updatePending,
} from "./pending-projects";
import {
	backoffDelayMs,
	classifyFailure,
	errorMessage,
	shouldGiveUp,
} from "./retry";

export type RegisterResult = {
	project: ProjectSummary;
	alreadyRegistered: boolean;
};

export type ReconcileDeps = {
	// Calls the registerProject server fn. Injected so the engine stays testable
	// without a real RPC.
	register: (input: {
		title: string;
		workspaceId?: string;
		automergeDocUrl: string;
	}) => Promise<RegisterResult>;
	// Gate: only drain when we have a live (online) authenticated session.
	hasLiveSession: () => boolean;
	// Fired after a record registers — wire query invalidation + route remap.
	onRegistered?: (record: PendingProject, project: ProjectSummary) => void;
	// Best-effort nudge so the browser repo re-announces the now-authorized doc
	// to the sync server.
	nudgeSync?: (automergeDocUrl: string) => void;
	now?: () => number;
	rng?: () => number;
};

// Process one record through a single registration attempt and persist the
// resulting state transition. Returns the updated record (or the original if
// it was skipped). Exported for direct unit testing.
export async function processRecord(
	record: PendingProject,
	deps: ReconcileDeps,
): Promise<PendingProject> {
	const now = deps.now ?? Date.now;
	const rng = deps.rng ?? Math.random;

	if (record.status === "registered") return record;
	// Respect a scheduled backoff window.
	if (record.nextRetryAt && record.nextRetryAt > now()) return record;

	await updatePending(record.localId, { status: "registering" });
	try {
		const result = await deps.register({
			title: record.title,
			workspaceId: record.workspaceId,
			automergeDocUrl: record.automergeDocUrl,
		});
		const updated = await updatePending(record.localId, {
			status: "registered",
			serverId: result.project.id,
			workspaceId: result.project.workspaceId,
			attempts: 0,
			lastError: undefined,
			lastErrorKind: undefined,
			nextRetryAt: undefined,
		});
		deps.onRegistered?.(record, result.project);
		deps.nudgeSync?.(record.automergeDocUrl);
		return updated ?? record;
	} catch (error) {
		const kind = classifyFailure(error);
		const message = errorMessage(error);

		if (kind === "auth") {
			// Session expired mid-drain. Don't burn an attempt — revert to pending
			// (no backoff) so the next drain after re-auth picks it straight up.
			return (
				(await updatePending(record.localId, {
					status: "pending",
					lastError: message,
					lastErrorKind: "auth",
					nextRetryAt: undefined,
				})) ?? record
			);
		}

		if (kind === "terminal" || kind === "conflict") {
			// Can't ever succeed as-is (no write access, or the doc belongs to
			// another account). Park for manual retry/discard.
			return (
				(await updatePending(record.localId, {
					status: "error",
					lastError: message,
					lastErrorKind: kind,
					nextRetryAt: undefined,
				})) ?? record
			);
		}

		// Transient: bump attempts, schedule backoff, or give up after the cap.
		const attempts = record.attempts + 1;
		if (shouldGiveUp(attempts)) {
			return (
				(await updatePending(record.localId, {
					status: "error",
					attempts,
					lastError: message,
					lastErrorKind: "transient",
					nextRetryAt: undefined,
				})) ?? record
			);
		}
		return (
			(await updatePending(record.localId, {
				status: "pending",
				attempts,
				lastError: message,
				lastErrorKind: "transient",
				nextRetryAt: now() + backoffDelayMs(attempts, rng),
			})) ?? record
		);
	}
}

// Drain every eligible record once. No-op (returns 0) without a live session so
// we don't hammer the server while signed out / offline. Records are processed
// sequentially to avoid a thundering herd against the workspace.
export async function reconcileOnce(deps: ReconcileDeps): Promise<number> {
	if (!deps.hasLiveSession()) return 0;
	await hydratePending();
	const now = deps.now ?? Date.now;
	let registered = 0;
	for (const record of getPendingSnapshot()) {
		if (record.status === "registered" || record.status === "error") continue;
		if (record.nextRetryAt && record.nextRetryAt > now()) continue;
		const result = await processRecord(record, deps);
		if (result.status === "registered") registered++;
	}
	return registered;
}

// Force a single record to retry now (manual "Retry now" button): clear the
// backoff window + error state and run one attempt.
export async function retryNow(
	localId: string,
	deps: ReconcileDeps,
): Promise<PendingProject | undefined> {
	const record = getPendingSnapshot().find((r) => r.localId === localId);
	if (!record) return undefined;
	const cleared =
		(await updatePending(localId, {
			status: "pending",
			nextRetryAt: undefined,
		})) ?? record;
	return processRecord({ ...cleared, nextRetryAt: undefined }, deps);
}

// --- Singleton controller ---------------------------------------------------
// The React hook (use-reconciler.ts) registers the live deps here so any
// caller (e.g. the create dialog, the "online" event, the status UI's manual
// retry) can request a drain without threading deps through props.

let activeDeps: ReconcileDeps | null = null;

export function setReconcileDeps(deps: ReconcileDeps | null): void {
	activeDeps = deps;
}

export async function requestReconcile(): Promise<number> {
	if (!activeDeps) return 0;
	return reconcileOnce(activeDeps);
}

export async function requestRetry(
	localId: string,
): Promise<PendingProject | undefined> {
	if (!activeDeps) return undefined;
	return retryNow(localId, activeDeps);
}

// Earliest scheduled retry across the queue, or null if nothing is waiting.
// The scheduler uses this to set a single timer instead of polling.
export function nextWakeAt(now: number): number | null {
	let min: number | null = null;
	for (const r of getPendingSnapshot()) {
		if (r.status !== "pending") continue;
		const at = r.nextRetryAt ?? now; // no backoff set → eligible immediately
		if (min === null || at < min) min = at;
	}
	return min;
}

// Sign-out that also tears down local-first state, so a shared machine doesn't
// leave the next person with the previous user's cached identity, persisted
// query cache, or IndexedDB-backed Automerge documents.
//
// Guards against silently discarding offline work: if there are projects that
// were created locally but never registered server-side, we confirm before
// wiping them (they only exist on this device).

import { authClient } from "#/lib/auth-client";
import { clearQueryPersistence } from "#/lib/query/persist-config";
import {
	getPendingSnapshot,
	hydratePending,
} from "#/lib/sync/pending-projects";
import { clearCachedIdentity } from "./offline-session";

const AUTOMERGE_IDB_NAME = "pert.li";

function deleteAutomergeStorage(): void {
	if (typeof indexedDB === "undefined") return;
	try {
		// Best-effort: an open repo connection can block deletion until the page
		// unloads. We reload right after sign-out, which releases it.
		indexedDB.deleteDatabase(AUTOMERGE_IDB_NAME);
	} catch {
		// Non-fatal — privacy cleanup is best-effort.
	}
}

export type SignOutOptions = {
	// Injectable for tests; defaults to window.confirm.
	confirm?: (message: string) => boolean;
	// Injectable for tests; defaults to a hard navigation to /signin.
	redirect?: () => void;
};

export async function signOutEverywhere(
	opts: SignOutOptions = {},
): Promise<void> {
	const confirmFn =
		opts.confirm ??
		(typeof window !== "undefined" ? window.confirm.bind(window) : () => true);

	await hydratePending();
	const unsynced = getPendingSnapshot().filter(
		(p) => p.status !== "registered",
	);
	if (unsynced.length > 0) {
		const ok = confirmFn(
			`You have ${unsynced.length} project${unsynced.length === 1 ? "" : "s"} that ${
				unsynced.length === 1 ? "hasn't" : "haven't"
			} synced yet. Signing out will permanently discard ${
				unsynced.length === 1 ? "it" : "them"
			} from this device. Continue?`,
		);
		if (!ok) return;
	}

	try {
		await authClient.signOut();
	} catch {
		// Even if the server call fails (e.g. offline), still clear local state.
	}

	clearCachedIdentity();
	await clearQueryPersistence();
	deleteAutomergeStorage();

	const redirect =
		opts.redirect ??
		(() => {
			if (typeof window !== "undefined") window.location.href = "/signin";
		});
	redirect();
}

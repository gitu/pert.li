import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";

// Active workspace id is purely a client preference — the server always
// re-checks membership when a workspaceId is supplied, so a stale value
// can't grant access. Stored in localStorage so a reload keeps the user on
// the workspace they were last looking at. `null` ⇒ fall back to whichever
// workspace the server treats as default (the personal one).

export const ACTIVE_WORKSPACE_KEY = "pertli.activeWorkspaceId";

// Workspace IDs are server-generated UUIDs (see `randomUUID()` in
// workspace-store.server.ts). Reject anything else from storage so a stale or
// hand-edited value can't sneak through and trigger a server-side schema
// rejection (`listProjectsInput` requires UUIDs).
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
	return UUID_REGEX.test(value);
}

type State = { workspaceId: string | null };

function read(): string | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
		if (!raw || !isUuid(raw)) return null;
		return raw;
	} catch {
		return null;
	}
}

function persist(id: string | null) {
	if (typeof window === "undefined") return;
	try {
		if (id && isUuid(id)) window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
		else window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
	} catch {
		// Storage quota / private mode — silently fall back to in-memory.
	}
}

const store = new Store<State>({ workspaceId: read() });

// Cross-tab sync. Without this, picking workspace B in tab 2 wouldn't
// invalidate the projects list in tab 1.
if (typeof window !== "undefined") {
	window.addEventListener("storage", (event) => {
		if (event.key !== ACTIVE_WORKSPACE_KEY) return;
		const next =
			event.newValue && isUuid(event.newValue) ? event.newValue : null;
		store.setState(() => ({ workspaceId: next }));
	});
}

export const activeWorkspace = {
	set(id: string | null) {
		// Defensive: callers should already pass a server-generated UUID, but
		// silently coercing a bad value to null beats letting it pollute the
		// store and trigger downstream input-validation errors.
		const next = id && isUuid(id) ? id : null;
		store.setState(() => ({ workspaceId: next }));
		persist(next);
	},
	get(): string | null {
		return store.state.workspaceId;
	},
};

export function useActiveWorkspaceId(): string | null {
	return useStore(store, (s) => s.workspaceId);
}

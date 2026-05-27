import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";

// Active workspace id is purely a client preference — the server always
// re-checks membership when a workspaceId is supplied, so a stale value
// can't grant access. Stored in localStorage so a reload keeps the user on
// the workspace they were last looking at. `null` ⇒ fall back to whichever
// workspace the server treats as default (the personal one).

export const ACTIVE_WORKSPACE_KEY = "pertli.activeWorkspaceId";

type State = { workspaceId: string | null };

function read(): string | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
		return raw && raw.length > 0 ? raw : null;
	} catch {
		return null;
	}
}

function persist(id: string | null) {
	if (typeof window === "undefined") return;
	try {
		if (id) window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
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
		store.setState({ workspaceId: event.newValue || null });
	});
}

export const activeWorkspace = {
	set(id: string | null) {
		store.setState({ workspaceId: id });
		persist(id);
	},
	get(): string | null {
		return store.state.workspaceId;
	},
};

export function useActiveWorkspaceId(): string | null {
	return useStore(store, (s) => s.workspaceId);
}

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useIsMobile } from "#/lib/use-media-query";

// Three runtime modes for the app shell:
//   desktop          — the wide-viewport ResizablePanelGroup shell.
//   mobile-readonly  — the phone shell with all edit affordances suppressed
//                      (managers consuming project state).
//   mobile-editing   — the phone shell with editing temporarily enabled
//                      (an editor making a quick fix from their phone).
//
// The editing flag is persisted to `sessionStorage` so it survives in-app
// navigation between projects, but resets to read-only on next visit /
// hard reload — that matches the manager-default intent.

export type ViewMode = "desktop" | "mobile-readonly" | "mobile-editing";

type ViewModeContextValue = {
	mode: ViewMode;
	isMobile: boolean;
	// Mobile-only: opt in / out of editing. No-op on desktop.
	setEditing: (next: boolean) => void;
};

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export const VIEW_MODE_SESSION_KEY = "pertli.viewMode.editing.v1";

function readPersistedEditing(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.sessionStorage.getItem(VIEW_MODE_SESSION_KEY) === "1";
	} catch {
		return false;
	}
}

function persistEditing(value: boolean) {
	if (typeof window === "undefined") return;
	try {
		if (value) window.sessionStorage.setItem(VIEW_MODE_SESSION_KEY, "1");
		else window.sessionStorage.removeItem(VIEW_MODE_SESSION_KEY);
	} catch {
		// sessionStorage may throw in private browsing — degrade to ephemeral.
	}
}

export function ViewModeProvider({
	children,
	forceReadOnly = false,
}: {
	children: ReactNode;
	// Public share-link routes pass `forceReadOnly` for view-mode shares —
	// the entire surface (desktop or mobile) reports as `mobile-readonly`,
	// which is the existing flag every edit affordance already gates on.
	// Keeping the value space tight avoids touching dozens of callsites.
	forceReadOnly?: boolean;
}) {
	const isMobile = useIsMobile();
	// SSR-safe: start `false`, then hydrate from sessionStorage in an effect.
	const [editing, setEditingState] = useState(false);
	useEffect(() => {
		setEditingState(readPersistedEditing());
	}, []);

	const setEditing = useCallback((next: boolean) => {
		setEditingState(next);
		persistEditing(next);
	}, []);

	const value = useMemo<ViewModeContextValue>(
		() => ({
			mode: forceReadOnly
				? "mobile-readonly"
				: isMobile
					? editing
						? "mobile-editing"
						: "mobile-readonly"
					: "desktop",
			isMobile,
			setEditing,
		}),
		[isMobile, editing, setEditing, forceReadOnly],
	);
	return (
		<ViewModeContext.Provider value={value}>
			{children}
		</ViewModeContext.Provider>
	);
}

export function useViewMode(): ViewModeContextValue {
	const ctx = useContext(ViewModeContext);
	if (!ctx) {
		throw new Error("useViewMode must be used inside a ViewModeProvider");
	}
	return ctx;
}

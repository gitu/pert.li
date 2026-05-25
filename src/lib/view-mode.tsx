import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useIsMobile } from "#/lib/use-media-query";

// Three runtime modes for the app shell:
//   desktop          — the wide-viewport ResizablePanelGroup shell.
//   mobile-readonly  — the phone shell with all edit affordances suppressed
//                      (managers consuming project state).
//   mobile-editing   — the phone shell with editing temporarily enabled
//                      (an editor making a quick fix from their phone).
// Phase 5 wires the `mobile-editing` toggle and persists the choice to
// sessionStorage. For Phase 1 the provider only reports the viewport-
// derived mode and stubs `setEditing` as a no-op.

export type ViewMode = "desktop" | "mobile-readonly" | "mobile-editing";

type ViewModeContextValue = {
	mode: ViewMode;
	isMobile: boolean;
	// Mobile-only: opt in / out of editing. No-op on desktop.
	setEditing: (next: boolean) => void;
};

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
	const isMobile = useIsMobile();
	const value = useMemo<ViewModeContextValue>(
		() => ({
			mode: isMobile ? "mobile-readonly" : "desktop",
			isMobile,
			setEditing: () => {},
		}),
		[isMobile],
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

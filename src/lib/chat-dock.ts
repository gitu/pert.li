import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";

// Three-state placement for the chat surface:
//   closed  — chat is not on screen at all
//   sheet   — chat is in the right-side Sheet overlay (default, transient)
//   pinned  — chat lives as a dedicated resizable column to the right of the
//             inspector; the user has anchored it for sustained reference,
//             e.g. while working through the tutorial.
//
// `pendingPrompt` is ephemeral: it carries a seeded message from a UI affordance
// (tutorial CTAs, "Ask the assistant" shortcuts) into the chat panel. The panel
// reads and consumes it exactly once on mount/prop-change, then calls `consume`
// to clear it so a later navigation doesn't replay the same prompt.

export type ChatDockMode = "closed" | "sheet" | "pinned";

export type ChatDockPendingPrompt = {
	text: string;
	autoSend: boolean;
};

type ChatDockState = {
	mode: ChatDockMode;
	pendingPrompt: ChatDockPendingPrompt | null;
};

export const CHAT_DOCK_KEY = "pertli.chatDock";

// Phone-sized viewport check used to clamp the pinned mode out of existence
// on mobile. The mobile shell has no pinned column to render into; allowing
// the dock to be "pinned" there would surface a Chat icon that thinks the
// chat is open while no panel is visible. We don't override storage — when
// the user later returns on desktop, their pinned preference still applies.
function isMobileViewport(): boolean {
	if (typeof window === "undefined") return false;
	return window.innerWidth < 768;
}

function readStoredMode(): ChatDockMode {
	if (typeof window === "undefined") return "closed";
	const raw = window.localStorage.getItem(CHAT_DOCK_KEY);
	if (raw === "closed" || raw === "sheet" || raw === "pinned") {
		// Pinned doesn't apply on mobile — start closed so the chat icon and
		// sheet behaviour match what the user sees on screen.
		if (raw === "pinned" && isMobileViewport()) return "closed";
		return raw;
	}
	return "closed";
}

function persist(mode: ChatDockMode) {
	if (typeof window === "undefined") return;
	// Only an explicit pin survives a reload — `sheet` is a transient overlay
	// and `closed` is the default, so neither needs to be written.
	if (mode === "pinned") window.localStorage.setItem(CHAT_DOCK_KEY, mode);
	else window.localStorage.removeItem(CHAT_DOCK_KEY);
}

export const chatDockStore = new Store<ChatDockState>({
	// `sheet` is treated as transient — we never restore it across reloads.
	// Only an explicit pin should survive a refresh.
	mode: readStoredMode() === "pinned" ? "pinned" : "closed",
	pendingPrompt: null,
});

function setMode(mode: ChatDockMode) {
	chatDockStore.setState((s) => (s.mode === mode ? s : { ...s, mode }));
	persist(mode);
}

export const chatDock = {
	openSheet() {
		// Pinning wins — opening the "sheet" while pinned is a no-op because the
		// chat is already on screen as a column.
		if (chatDockStore.state.mode === "pinned") return;
		setMode("sheet");
	},
	close() {
		setMode("closed");
	},
	togglePin() {
		// Pinning has no effect on a phone — the mobile shell only renders the
		// sheet target. Flip to sheet so the chat actually opens for the user.
		if (isMobileViewport()) {
			setMode("sheet");
			return;
		}
		const current = chatDockStore.state.mode;
		setMode(current === "pinned" ? "sheet" : "pinned");
	},
	// Open the chat and queue a starter message. Used by tutorial CTAs and any
	// future "deep-link into the assistant" affordance. Pinned is the desktop
	// "anchored beside your work" placement; a phone has no pinned column, so
	// pinning there would teleport the chat into the hidden fallback host and
	// the seeded prompt would auto-send with nothing on screen. Fall back to
	// the sheet on mobile, mirroring togglePin's clamp.
	startWith(prompt: string, opts: { autoSend?: boolean } = {}) {
		const mode: ChatDockMode = isMobileViewport() ? "sheet" : "pinned";
		chatDockStore.setState(() => ({
			mode,
			pendingPrompt: { text: prompt, autoSend: opts.autoSend ?? true },
		}));
		persist(mode);
	},
	consumePendingPrompt(): ChatDockPendingPrompt | null {
		const pending = chatDockStore.state.pendingPrompt;
		if (!pending) return null;
		chatDockStore.setState((s) => ({ ...s, pendingPrompt: null }));
		return pending;
	},
};

export function useChatDockMode(): ChatDockMode {
	return useStore(chatDockStore, (s) => s.mode);
}

export function useChatDockPendingPrompt(): ChatDockPendingPrompt | null {
	return useStore(chatDockStore, (s) => s.pendingPrompt);
}

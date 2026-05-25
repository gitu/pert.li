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

function readStoredMode(): ChatDockMode {
	if (typeof window === "undefined") return "closed";
	const raw = window.localStorage.getItem(CHAT_DOCK_KEY);
	if (raw === "closed" || raw === "sheet" || raw === "pinned") return raw;
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
		const current = chatDockStore.state.mode;
		setMode(current === "pinned" ? "sheet" : "pinned");
	},
	// Open the chat pinned and queue a starter message. Used by tutorial CTAs
	// and any future "deep-link into the assistant" affordance.
	startWith(prompt: string, opts: { autoSend?: boolean } = {}) {
		chatDockStore.setState(() => ({
			mode: "pinned",
			pendingPrompt: { text: prompt, autoSend: opts.autoSend ?? true },
		}));
		persist("pinned");
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

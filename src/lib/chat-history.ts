// Local persistence + cross-tab sync for the in-app chat.
//
// Only the conversation transcript (user + assistant messages, tool calls,
// tool results) lives here. The SYSTEM PROMPT is never stored client-side —
// it's added on the server in chat.server.ts on every request. That keeps
// the prompt swappable without invalidating saved conversations and avoids
// leaking the prompt into the user's browser storage.

const STORAGE_KEY = "pertli.chatMessages.v1";
const CHANNEL_NAME = "pertli.chat";

// We can't import the @tanstack/ai message type from this file (it'd pull
// React into the lib layer). The shape we round-trip through localStorage
// is fully opaque to us — useChat hands us an array, we serialize it back
// out unchanged.
export type ChatMessagesSnapshot = unknown[];

export function readChatMessages(): ChatMessagesSnapshot | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function writeChatMessages(messages: ChatMessagesSnapshot) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
	} catch {
		// Out-of-quota or storage disabled — silently drop. The chat still
		// works in memory; only persistence is lost.
	}
}

export function clearChatMessages() {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

// Cross-tab broadcast. Each tab can post its current transcript to all
// other tabs of the same origin. Listeners receive the snapshot and
// reconcile via the consumer's `onRemote` callback.
//
// We use BroadcastChannel when available (modern browsers) and fall back
// to a localStorage `storage` event listener for older / restricted
// environments. Storage events fire in OTHER tabs only, which is exactly
// what we want.

type Listener = (snapshot: ChatMessagesSnapshot) => void;

export type ChatBroadcaster = {
	post(snapshot: ChatMessagesSnapshot): void;
	subscribe(fn: Listener): () => void;
	close(): void;
};

export function createChatBroadcaster(): ChatBroadcaster {
	if (typeof window === "undefined") {
		return {
			post: () => {},
			subscribe: () => () => {},
			close: () => {},
		};
	}
	const listeners = new Set<Listener>();
	const supportsBC = typeof BroadcastChannel !== "undefined";
	let channel: BroadcastChannel | null = null;
	if (supportsBC) {
		channel = new BroadcastChannel(CHANNEL_NAME);
		channel.addEventListener("message", (ev) => {
			if (!Array.isArray(ev.data)) return;
			for (const fn of listeners) fn(ev.data);
		});
	}
	const onStorage = (ev: StorageEvent) => {
		if (ev.key !== STORAGE_KEY || !ev.newValue) return;
		try {
			const parsed = JSON.parse(ev.newValue);
			if (!Array.isArray(parsed)) return;
			for (const fn of listeners) fn(parsed);
		} catch {
			// ignore malformed payloads
		}
	};
	window.addEventListener("storage", onStorage);
	return {
		post(snapshot) {
			channel?.postMessage(snapshot);
		},
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		close() {
			channel?.close();
			window.removeEventListener("storage", onStorage);
			listeners.clear();
		},
	};
}

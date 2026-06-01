// Local persistence + cross-tab sync for the in-app chat.
//
// Only the conversation transcript (user + assistant messages, tool calls,
// tool results) lives here. The SYSTEM PROMPT is never stored client-side —
// it's added on the server in chat.server.ts on every request. That keeps
// the prompt swappable without invalidating saved conversations and avoids
// leaking the prompt into the user's browser storage.
//
// Storage layout
// --------------
// Threads are scoped per project — the chat is only available when a project
// is open, so `getScopeKey` returns null without one. Each project scope has:
//
//   pertli.chatThreads.v1.<scopeKey>   →  ThreadIndex (active id + metadata)
//   pertli.chatThread.v1.<threadId>    →  ChatMessagesSnapshot (opaque)
//
// The thread index lives separately from the message snapshots so renaming /
// creating / switching tabs doesn't have to rewrite (potentially long)
// transcripts.

const INDEX_KEY_PREFIX = "pertli.chatThreads.v1.";
const THREAD_KEY_PREFIX = "pertli.chatThread.v1.";
const CHANNEL_NAME = "pertli.chat";

// We can't import the @tanstack/ai message type from this file (it'd pull
// React into the lib layer). The shape we round-trip through localStorage
// is fully opaque to us — useChat hands us an array, we serialize it back
// out unchanged.
export type ChatMessagesSnapshot = unknown[];

export type ThreadMeta = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
};

export type ThreadIndex = {
	activeThreadId: string;
	threads: ThreadMeta[];
};

export const DEFAULT_THREAD_TITLE = "New chat";

export function getScopeKey(
	projectId: string | null | undefined,
): string | null {
	return projectId ? `project:${projectId}` : null;
}

function indexStorageKey(scopeKey: string): string {
	return `${INDEX_KEY_PREFIX}${scopeKey}`;
}

function threadStorageKey(threadId: string): string {
	return `${THREAD_KEY_PREFIX}${threadId}`;
}

function newThreadId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `t_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function makeEmptyThread(now: number): ThreadMeta {
	return {
		id: newThreadId(),
		title: DEFAULT_THREAD_TITLE,
		createdAt: now,
		updatedAt: now,
	};
}

function isThreadMeta(value: unknown): value is ThreadMeta {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.id === "string" &&
		typeof v.title === "string" &&
		typeof v.createdAt === "number" &&
		typeof v.updatedAt === "number"
	);
}

function isThreadIndex(value: unknown): value is ThreadIndex {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (typeof v.activeThreadId !== "string") return false;
	if (!Array.isArray(v.threads)) return false;
	return v.threads.every(isThreadMeta);
}

// Returns the thread index for a scope, ensuring at least one thread exists.
export function readThreadIndex(scopeKey: string): ThreadIndex {
	if (typeof window === "undefined") {
		// SSR fallback — caller will re-read on the client.
		const now = Date.now();
		const t = makeEmptyThread(now);
		return { activeThreadId: t.id, threads: [t] };
	}
	const raw = safeGet(indexStorageKey(scopeKey));
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (isThreadIndex(parsed) && parsed.threads.length > 0) {
				const known = new Set(parsed.threads.map((t) => t.id));
				if (!known.has(parsed.activeThreadId)) {
					return {
						activeThreadId: parsed.threads[0].id,
						threads: parsed.threads,
					};
				}
				return parsed;
			}
		} catch {
			// fall through and reseed
		}
	}
	const now = Date.now();
	const t = makeEmptyThread(now);
	const seeded: ThreadIndex = { activeThreadId: t.id, threads: [t] };
	writeThreadIndex(scopeKey, seeded);
	return seeded;
}

export function writeThreadIndex(scopeKey: string, index: ThreadIndex): void {
	if (typeof window === "undefined") return;
	safeSet(indexStorageKey(scopeKey), JSON.stringify(index));
}

export function readThreadMessages(
	threadId: string,
): ChatMessagesSnapshot | null {
	if (typeof window === "undefined") return null;
	const raw = safeGet(threadStorageKey(threadId));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function writeThreadMessages(
	threadId: string,
	messages: ChatMessagesSnapshot,
): void {
	if (typeof window === "undefined") return;
	safeSet(threadStorageKey(threadId), JSON.stringify(messages));
}

export function clearThreadMessages(threadId: string): void {
	if (typeof window === "undefined") return;
	safeRemove(threadStorageKey(threadId));
}

// Best-effort title derivation: take the first user message's text content,
// strip newlines, truncate to ~40 chars. Returns null when the snapshot has
// no user-authored text yet (so the caller can keep the placeholder).
export function deriveThreadTitle(
	messages: ChatMessagesSnapshot,
): string | null {
	for (const m of messages) {
		if (!m || typeof m !== "object") continue;
		const msg = m as Record<string, unknown>;
		if (msg.role !== "user") continue;
		const text = extractText(msg);
		if (!text) continue;
		const firstLine = text.split(/\r?\n/)[0]?.trim();
		if (!firstLine) continue;
		return firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
	}
	return null;
}

function extractText(msg: Record<string, unknown>): string {
	// useChat's UIMessage carries `parts: [{ type: "text", content: string }]`.
	// Older shapes used plain `content: string`. Tolerate both.
	if (typeof msg.content === "string") return msg.content;
	const parts = msg.parts;
	if (!Array.isArray(parts)) return "";
	const chunks: string[] = [];
	for (const p of parts) {
		if (!p || typeof p !== "object") continue;
		const part = p as Record<string, unknown>;
		if (part.type !== "text") continue;
		const text =
			typeof part.content === "string"
				? part.content
				: typeof part.text === "string"
					? part.text
					: "";
		if (text) chunks.push(text);
	}
	return chunks.join(" ").trim();
}

function safeGet(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSet(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Out-of-quota or storage disabled — silently drop. The chat still
		// works in memory; only persistence is lost.
	}
}

function safeRemove(key: string): void {
	try {
		window.localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

// Cross-tab broadcast. Each tab can post thread-index changes (a tab was
// added / renamed / deleted) or transcript updates to all other tabs of the
// same origin. Listeners receive the typed payload.
//
// We use BroadcastChannel when available (modern browsers) and fall back to
// a localStorage `storage` event listener for older / restricted envs.
// Storage events fire in OTHER tabs only, which is exactly what we want.

export type ChatBroadcast =
	| {
			type: "messages";
			scopeKey: string;
			threadId: string;
			snapshot: ChatMessagesSnapshot;
	  }
	| { type: "index"; scopeKey: string; index: ThreadIndex };

type Listener = (payload: ChatBroadcast) => void;

export type ChatBroadcaster = {
	post(payload: ChatBroadcast): void;
	subscribe(fn: Listener): () => void;
	close(): void;
};

function isChatBroadcast(value: unknown): value is ChatBroadcast {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (typeof v.scopeKey !== "string") return false;
	if (v.type === "messages") {
		return typeof v.threadId === "string" && Array.isArray(v.snapshot);
	}
	if (v.type === "index") {
		return isThreadIndex(v.index);
	}
	return false;
}

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
			if (!isChatBroadcast(ev.data)) return;
			for (const fn of listeners) fn(ev.data);
		});
	}
	const onStorage = (ev: StorageEvent) => {
		if (!ev.key || !ev.newValue) return;
		if (ev.key.startsWith(THREAD_KEY_PREFIX)) {
			const threadId = ev.key.slice(THREAD_KEY_PREFIX.length);
			try {
				const parsed = JSON.parse(ev.newValue);
				if (!Array.isArray(parsed)) return;
				const payload: ChatBroadcast = {
					type: "messages",
					// We don't know the scope at the storage layer — listeners that
					// care match on threadId, which is globally unique.
					scopeKey: "",
					threadId,
					snapshot: parsed,
				};
				for (const fn of listeners) fn(payload);
			} catch {
				// ignore malformed payloads
			}
			return;
		}
		if (ev.key.startsWith(INDEX_KEY_PREFIX)) {
			const scopeKey = ev.key.slice(INDEX_KEY_PREFIX.length);
			try {
				const parsed = JSON.parse(ev.newValue);
				if (!isThreadIndex(parsed)) return;
				for (const fn of listeners)
					fn({ type: "index", scopeKey, index: parsed });
			} catch {
				// ignore
			}
		}
	};
	window.addEventListener("storage", onStorage);
	return {
		post(payload) {
			channel?.postMessage(payload);
		},
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		close() {
			channel?.close();
			channel = null;
			window.removeEventListener("storage", onStorage);
			listeners.clear();
		},
	};
}

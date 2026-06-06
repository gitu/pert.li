// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ChatBroadcast,
	createChatBroadcaster,
	DEFAULT_THREAD_TITLE,
	deriveThreadTitle,
	ensureActiveThread,
	getScopeKey,
	moveThreadToScope,
	readThreadIndex,
	readThreadMessages,
	type ThreadIndex,
	writeThreadIndex,
	writeThreadMessages,
} from "#/lib/chat-history";

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	window.localStorage.clear();
});

describe("getScopeKey", () => {
	it("returns null when no project id is provided — chat is bound to a project", () => {
		expect(getScopeKey(null)).toBeNull();
		expect(getScopeKey(undefined)).toBeNull();
		expect(getScopeKey("")).toBeNull();
	});

	it("prefixes a project scope with project:", () => {
		expect(getScopeKey("p_abc")).toBe("project:p_abc");
	});
});

describe("readThreadIndex", () => {
	it("returns an empty index when nothing is stored — no auto-seed", () => {
		const idx = readThreadIndex("project:a");
		expect(idx.threads).toEqual([]);
		expect(idx.activeThreadId).toBeNull();
	});

	it("does not write to storage on read (reads are side-effect free)", () => {
		readThreadIndex("project:a");
		expect(
			window.localStorage.getItem("pertli.chatThreads.v1.project:a"),
		).toBeNull();
	});

	it("round-trips a zero-thread index", () => {
		const empty: ThreadIndex = { activeThreadId: null, threads: [] };
		writeThreadIndex("project:a", empty);
		expect(readThreadIndex("project:a")).toEqual(empty);
	});

	it("scopes are isolated — writing one leaves the other empty", () => {
		const a: ThreadIndex = {
			activeThreadId: "ta",
			threads: [{ id: "ta", title: "A", createdAt: 1, updatedAt: 1 }],
		};
		writeThreadIndex("project:a", a);
		expect(readThreadIndex("project:a")).toEqual(a);
		expect(readThreadIndex("project:b")).toEqual({
			activeThreadId: null,
			threads: [],
		});
	});

	it("repairs an index whose activeThreadId points at a non-existent thread", () => {
		const fake: ThreadIndex = {
			activeThreadId: "ghost",
			threads: [
				{ id: "real", title: "Real", createdAt: 1, updatedAt: 1 },
				{ id: "other", title: "Other", createdAt: 2, updatedAt: 2 },
			],
		};
		writeThreadIndex("project:a", fake);
		const idx = readThreadIndex("project:a");
		expect(idx.activeThreadId).toBe("real");
	});

	it("falls back to null activeThreadId when a stored index has no threads", () => {
		writeThreadIndex("project:a", {
			activeThreadId: "ghost",
			threads: [],
		});
		const idx = readThreadIndex("project:a");
		expect(idx.activeThreadId).toBeNull();
		expect(idx.threads).toEqual([]);
	});

	it("returns an empty index when the stored index is malformed", () => {
		window.localStorage.setItem(
			"pertli.chatThreads.v1.project:a",
			"{not json}",
		);
		const idx = readThreadIndex("project:a");
		expect(idx.threads).toEqual([]);
		expect(idx.activeThreadId).toBeNull();
	});
});

describe("ensureActiveThread", () => {
	it("creates the thread and marks it active when the scope is empty", () => {
		const idx = ensureActiveThread("project:tut", {
			id: "tutorial",
			title: "Tutorial",
		});
		expect(idx.activeThreadId).toBe("tutorial");
		expect(idx.threads).toEqual([
			expect.objectContaining({ id: "tutorial", title: "Tutorial" }),
		]);
		// Persisted, so the chat panel reads it back after navigation.
		expect(readThreadIndex("project:tut")).toEqual(idx);
	});

	it("re-activates an existing thread without touching its title or duplicating it", () => {
		writeThreadIndex("project:tut", {
			activeThreadId: "other",
			threads: [
				{
					id: "tutorial",
					title: "Renamed by user",
					createdAt: 1,
					updatedAt: 1,
				},
				{ id: "other", title: "Other", createdAt: 2, updatedAt: 2 },
			],
		});

		const idx = ensureActiveThread("project:tut", {
			id: "tutorial",
			title: "Tutorial",
		});

		expect(idx.activeThreadId).toBe("tutorial");
		// No duplicate, and the user's rename survives.
		expect(idx.threads).toHaveLength(2);
		expect(idx.threads.find((t) => t.id === "tutorial")?.title).toBe(
			"Renamed by user",
		);
	});

	it("appends the reserved thread alongside the user's existing threads", () => {
		writeThreadIndex("project:tut", {
			activeThreadId: "mine",
			threads: [{ id: "mine", title: "My chat", createdAt: 1, updatedAt: 1 }],
		});

		const idx = ensureActiveThread("project:tut", {
			id: "tutorial",
			title: "Tutorial",
		});

		expect(idx.activeThreadId).toBe("tutorial");
		expect(idx.threads.map((t) => t.id).sort()).toEqual(["mine", "tutorial"]);
	});
});

describe("readThreadMessages / writeThreadMessages", () => {
	it("returns null when nothing is stored for a thread", () => {
		expect(readThreadMessages("missing")).toBeNull();
	});

	it("round-trips an array snapshot", () => {
		const snapshot = [
			{ id: "u1", role: "user", parts: [{ type: "text", content: "hi" }] },
			{ id: "a1", role: "assistant", parts: [] },
		];
		writeThreadMessages("t1", snapshot);
		expect(readThreadMessages("t1")).toEqual(snapshot);
	});

	it("returns null when the stored payload is malformed JSON", () => {
		window.localStorage.setItem("pertli.chatThread.v1.t1", "{not json");
		expect(readThreadMessages("t1")).toBeNull();
	});

	it("returns null when the stored payload is not an array", () => {
		window.localStorage.setItem("pertli.chatThread.v1.t1", '"oops"');
		expect(readThreadMessages("t1")).toBeNull();
	});
});

describe("moveThreadToScope", () => {
	it("moves a thread between scopes and makes it active in the target", () => {
		// Source scope with two threads; we'll move the active one.
		const source: ThreadIndex = {
			activeThreadId: "moving",
			threads: [
				{ id: "moving", title: "Branch planning", createdAt: 1, updatedAt: 1 },
				{ id: "staying", title: "Other chat", createdAt: 2, updatedAt: 2 },
			],
		};
		writeThreadIndex("project:parent", source);
		writeThreadMessages("moving", [{ id: "u1", role: "user" }]);

		moveThreadToScope("moving", "project:parent", "project:branch");

		// Source: thread removed, the remaining one became active.
		const fromIndex = readThreadIndex("project:parent");
		expect(fromIndex.threads.map((t) => t.id)).toEqual(["staying"]);
		expect(fromIndex.activeThreadId).toBe("staying");

		// Target: thread present and active; transcript untouched (keyed by
		// threadId, not scope).
		const toIndex = readThreadIndex("project:branch");
		expect(toIndex.activeThreadId).toBe("moving");
		expect(toIndex.threads.map((t) => t.id)).toContain("moving");
		expect(readThreadMessages("moving")).toEqual([{ id: "u1", role: "user" }]);
	});

	it("leaves the source scope empty when the moved thread was the only one", () => {
		const source: ThreadIndex = {
			activeThreadId: "only",
			threads: [{ id: "only", title: "Solo", createdAt: 1, updatedAt: 1 }],
		};
		writeThreadIndex("project:parent", source);

		moveThreadToScope("only", "project:parent", "project:branch");

		const fromIndex = readThreadIndex("project:parent");
		expect(fromIndex.threads).toEqual([]);
		expect(fromIndex.activeThreadId).toBeNull();
	});

	it("keeps an existing empty 'New chat' thread in the target scope (no longer treated as a dead placeholder)", () => {
		// Auto-seeding is gone, so an empty "New chat" in the target is a
		// user-created thread and must not be silently dropped on move.
		writeThreadIndex("project:branch", {
			activeThreadId: "user-empty",
			threads: [
				{
					id: "user-empty",
					title: DEFAULT_THREAD_TITLE,
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});

		const source: ThreadIndex = {
			activeThreadId: "moving",
			threads: [
				{ id: "moving", title: "Planning", createdAt: 2, updatedAt: 2 },
			],
		};
		writeThreadIndex("project:parent", source);

		moveThreadToScope("moving", "project:parent", "project:branch");

		const toIndex = readThreadIndex("project:branch");
		// Both threads survive; the moved one becomes active.
		expect(toIndex.threads.map((t) => t.id).sort()).toEqual([
			"moving",
			"user-empty",
		]);
		expect(toIndex.activeThreadId).toBe("moving");
	});

	it("keeps non-empty threads already in the target scope", () => {
		const target: ThreadIndex = {
			activeThreadId: "existing",
			threads: [
				{ id: "existing", title: "Already here", createdAt: 1, updatedAt: 1 },
			],
		};
		writeThreadIndex("project:branch", target);
		writeThreadMessages("existing", [{ id: "u1", role: "user" }]);

		const source: ThreadIndex = {
			activeThreadId: "moving",
			threads: [
				{ id: "moving", title: "Planning", createdAt: 2, updatedAt: 2 },
			],
		};
		writeThreadIndex("project:parent", source);

		moveThreadToScope("moving", "project:parent", "project:branch");

		const toIndex = readThreadIndex("project:branch");
		expect(toIndex.threads.map((t) => t.id).sort()).toEqual([
			"existing",
			"moving",
		]);
		expect(toIndex.activeThreadId).toBe("moving");
	});

	it("is a no-op when the thread doesn't exist in the source scope", () => {
		const source: ThreadIndex = {
			activeThreadId: "a",
			threads: [{ id: "a", title: "A", createdAt: 1, updatedAt: 1 }],
		};
		writeThreadIndex("project:parent", source);

		moveThreadToScope("ghost", "project:parent", "project:branch");

		expect(readThreadIndex("project:parent").threads.map((t) => t.id)).toEqual([
			"a",
		]);
	});

	it("is a no-op when source and target scopes are identical", () => {
		const source: ThreadIndex = {
			activeThreadId: "a",
			threads: [
				{ id: "a", title: "A", createdAt: 1, updatedAt: 1 },
				{ id: "b", title: "B", createdAt: 2, updatedAt: 2 },
			],
		};
		writeThreadIndex("project:parent", source);

		moveThreadToScope("a", "project:parent", "project:parent");

		expect(readThreadIndex("project:parent")).toEqual(source);
	});
});

describe("deriveThreadTitle", () => {
	it("returns null when no user message is present", () => {
		expect(deriveThreadTitle([])).toBeNull();
		expect(
			deriveThreadTitle([
				{
					id: "a1",
					role: "assistant",
					parts: [{ type: "text", content: "hi" }],
				},
			]),
		).toBeNull();
	});

	it("uses the first user message text", () => {
		expect(
			deriveThreadTitle([
				{
					id: "u1",
					role: "user",
					parts: [{ type: "text", content: "Plan the launch" }],
				},
				{
					id: "u2",
					role: "user",
					parts: [{ type: "text", content: "Then ship it" }],
				},
			]),
		).toBe("Plan the launch");
	});

	it("falls back to legacy content shape", () => {
		expect(
			deriveThreadTitle([
				{ id: "u1", role: "user", content: "Legacy shape works too" },
			]),
		).toBe("Legacy shape works too");
	});

	it("truncates long titles to 40 characters with an ellipsis", () => {
		const long = "a".repeat(200);
		const title = deriveThreadTitle([
			{ id: "u1", role: "user", parts: [{ type: "text", content: long }] },
		]);
		expect(title).not.toBeNull();
		expect(title?.length).toBeLessThanOrEqual(40);
		expect(title?.endsWith("…")).toBe(true);
	});

	it("trims to the first line on multi-line input", () => {
		expect(
			deriveThreadTitle([
				{
					id: "u1",
					role: "user",
					parts: [
						{ type: "text", content: "First line\nSecond line\nThird line" },
					],
				},
			]),
		).toBe("First line");
	});

	it("ignores empty text parts before any usable content", () => {
		expect(
			deriveThreadTitle([
				{
					id: "u1",
					role: "user",
					parts: [
						{ type: "tool-call", toolName: "foo" },
						{ type: "text", content: "actual question" },
					],
				},
			]),
		).toBe("actual question");
	});
});

describe("createChatBroadcaster — BroadcastChannel path", () => {
	it("post does not deliver to the SAME page's subscribers (BC semantics)", () => {
		const bus = createChatBroadcaster();
		const seen: ChatBroadcast[] = [];
		bus.subscribe((p) => seen.push(p));
		bus.post({
			type: "messages",
			scopeKey: "project:a",
			threadId: "t1",
			snapshot: [{ id: "u1" }],
		});
		expect(seen).toEqual([]);
		bus.close();
	});

	it("close() unsubscribes and is idempotent", () => {
		const bus = createChatBroadcaster();
		const fn = vi.fn();
		bus.subscribe(fn);
		bus.close();
		bus.close();
		expect(fn).not.toHaveBeenCalled();
	});

	it("subscribe returns an unsubscribe", () => {
		const bus = createChatBroadcaster();
		const fn = vi.fn();
		const unsub = bus.subscribe(fn);
		unsub();
		bus.close();
		expect(fn).not.toHaveBeenCalled();
	});
});

describe("createChatBroadcaster — storage-event fallback", () => {
	it("synthesises a messages payload from a per-thread storage event", () => {
		const bus = createChatBroadcaster();
		const seen: ChatBroadcast[] = [];
		bus.subscribe((p) => seen.push(p));
		const snapshot = [{ id: "u1", role: "user" }];
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "pertli.chatThread.v1.thread-xyz",
				newValue: JSON.stringify(snapshot),
			}),
		);
		expect(seen).toHaveLength(1);
		const payload = seen[0];
		expect(payload.type).toBe("messages");
		if (payload.type === "messages") {
			expect(payload.threadId).toBe("thread-xyz");
			expect(payload.snapshot).toEqual(snapshot);
		}
		bus.close();
	});

	it("synthesises an index payload from a per-scope storage event", () => {
		const bus = createChatBroadcaster();
		const seen: ChatBroadcast[] = [];
		bus.subscribe((p) => seen.push(p));
		const index: ThreadIndex = {
			activeThreadId: "t1",
			threads: [{ id: "t1", title: "x", createdAt: 1, updatedAt: 1 }],
		};
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "pertli.chatThreads.v1.project:abc",
				newValue: JSON.stringify(index),
			}),
		);
		expect(seen).toHaveLength(1);
		const payload = seen[0];
		expect(payload.type).toBe("index");
		if (payload.type === "index") {
			expect(payload.scopeKey).toBe("project:abc");
			expect(payload.index).toEqual(index);
		}
		bus.close();
	});

	it("ignores storage events for unrelated keys", () => {
		const bus = createChatBroadcaster();
		const seen: ChatBroadcast[] = [];
		bus.subscribe((p) => seen.push(p));
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "something.else",
				newValue: JSON.stringify([{ id: "u1" }]),
			}),
		);
		expect(seen).toEqual([]);
		bus.close();
	});

	it("ignores storage events whose thread payload is not an array", () => {
		const bus = createChatBroadcaster();
		const seen: ChatBroadcast[] = [];
		bus.subscribe((p) => seen.push(p));
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "pertli.chatThread.v1.t1",
				newValue: '"not an array"',
			}),
		);
		expect(seen).toEqual([]);
		bus.close();
	});

	it("ignores storage events whose index payload fails validation", () => {
		const bus = createChatBroadcaster();
		const seen: ChatBroadcast[] = [];
		bus.subscribe((p) => seen.push(p));
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "pertli.chatThreads.v1.project:a",
				newValue: JSON.stringify({ activeThreadId: 1, threads: [] }),
			}),
		);
		expect(seen).toEqual([]);
		bus.close();
	});
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ChatBroadcast,
	createChatBroadcaster,
	DEFAULT_THREAD_TITLE,
	deriveThreadTitle,
	getScopeKey,
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
	it("seeds a single default thread when nothing is stored", () => {
		const idx = readThreadIndex("project:a");
		expect(idx.threads).toHaveLength(1);
		expect(idx.activeThreadId).toBe(idx.threads[0].id);
		expect(idx.threads[0].title).toBe(DEFAULT_THREAD_TITLE);
	});

	it("persists the seeded index so a second read returns the same thread id", () => {
		const first = readThreadIndex("project:a");
		const second = readThreadIndex("project:a");
		expect(second.activeThreadId).toBe(first.activeThreadId);
		expect(second.threads).toEqual(first.threads);
	});

	it("scopes are isolated", () => {
		const a = readThreadIndex("project:a");
		const b = readThreadIndex("project:b");
		expect(a.activeThreadId).not.toBe(b.activeThreadId);
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

	it("reseeds when the stored index is malformed", () => {
		window.localStorage.setItem(
			"pertli.chatThreads.v1.project:a",
			"{not json}",
		);
		const idx = readThreadIndex("project:a");
		expect(idx.threads).toHaveLength(1);
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

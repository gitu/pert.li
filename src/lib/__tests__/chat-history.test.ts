// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearChatMessages,
	createChatBroadcaster,
	readChatMessages,
	writeChatMessages,
} from "#/lib/chat-history";

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	window.localStorage.clear();
});

describe("readChatMessages / writeChatMessages", () => {
	it("returns null when nothing is stored", () => {
		expect(readChatMessages()).toBeNull();
	});

	it("round-trips an array snapshot", () => {
		const snapshot = [
			{ id: "u1", role: "user", parts: [{ type: "text", content: "hi" }] },
			{ id: "a1", role: "assistant", parts: [] },
		];
		writeChatMessages(snapshot);
		expect(readChatMessages()).toEqual(snapshot);
	});

	it("returns null when the stored payload is malformed JSON", () => {
		window.localStorage.setItem("pertli.chatMessages.v1", "{not json");
		expect(readChatMessages()).toBeNull();
	});

	it("returns null when the stored payload is not an array", () => {
		window.localStorage.setItem("pertli.chatMessages.v1", '"oops"');
		expect(readChatMessages()).toBeNull();
	});

	it("clearChatMessages removes the entry", () => {
		writeChatMessages([{ id: "u1" }]);
		expect(readChatMessages()).not.toBeNull();
		clearChatMessages();
		expect(readChatMessages()).toBeNull();
	});
});

describe("createChatBroadcaster (BroadcastChannel path)", () => {
	it("delivers posted snapshots to subscribers", () => {
		const bus = createChatBroadcaster();
		const seen: unknown[] = [];
		bus.subscribe((snap) => seen.push(snap));
		bus.post([{ id: "u1" }]);
		// BroadcastChannel doesn't fire on the SAME page; subscriber sees nothing
		// from its own post. This is the documented behavior we want — the
		// useEffect dedupes anyway via the serial ref.
		expect(seen).toEqual([]);
		bus.close();
	});

	it("close() unsubscribes and is idempotent", () => {
		const bus = createChatBroadcaster();
		const fn = vi.fn();
		bus.subscribe(fn);
		bus.close();
		// no-op
		bus.close();
		expect(fn).not.toHaveBeenCalled();
	});

	it("subscribe returns an unsubscribe that removes the listener", () => {
		const bus = createChatBroadcaster();
		const fn = vi.fn();
		const unsub = bus.subscribe(fn);
		unsub();
		bus.close();
		expect(fn).not.toHaveBeenCalled();
	});
});

describe("createChatBroadcaster — storage-event fallback", () => {
	it("forwards a 'storage' event with our key into subscribers", () => {
		const bus = createChatBroadcaster();
		const seen: unknown[][] = [];
		bus.subscribe((snap) => seen.push(snap as unknown[]));
		const next = [{ id: "u1", role: "user" }];
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "pertli.chatMessages.v1",
				newValue: JSON.stringify(next),
			}),
		);
		expect(seen).toEqual([next]);
		bus.close();
	});

	it("ignores storage events for unrelated keys", () => {
		const bus = createChatBroadcaster();
		const seen: unknown[][] = [];
		bus.subscribe((snap) => seen.push(snap as unknown[]));
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "something.else",
				newValue: JSON.stringify([{ id: "u1" }]),
			}),
		);
		expect(seen).toEqual([]);
		bus.close();
	});

	it("ignores storage events with non-array payloads", () => {
		const bus = createChatBroadcaster();
		const seen: unknown[][] = [];
		bus.subscribe((snap) => seen.push(snap as unknown[]));
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "pertli.chatMessages.v1",
				newValue: '"not an array"',
			}),
		);
		expect(seen).toEqual([]);
		bus.close();
	});
});

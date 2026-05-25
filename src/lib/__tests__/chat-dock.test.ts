import { beforeEach, describe, expect, it } from "vitest";
import { chatDock, chatDockStore } from "#/lib/chat-dock";

// The store module reads localStorage at import time to seed its initial mode.
// Tests run under the "node" environment (no `window`), so the SSR guards take
// over and the store boots in `closed`. We reset to that baseline between
// cases so transitions are deterministic.

function reset() {
	chatDockStore.setState(() => ({ mode: "closed", pendingPrompt: null }));
}

describe("chatDock actions", () => {
	beforeEach(reset);

	it("opens as sheet by default", () => {
		chatDock.openSheet();
		expect(chatDockStore.state.mode).toBe("sheet");
	});

	it("close transitions to closed", () => {
		chatDock.openSheet();
		chatDock.close();
		expect(chatDockStore.state.mode).toBe("closed");
	});

	it("togglePin flips between sheet and pinned", () => {
		chatDock.openSheet();
		chatDock.togglePin();
		expect(chatDockStore.state.mode).toBe("pinned");
		chatDock.togglePin();
		expect(chatDockStore.state.mode).toBe("sheet");
	});

	it("togglePin from closed lands on pinned", () => {
		expect(chatDockStore.state.mode).toBe("closed");
		chatDock.togglePin();
		expect(chatDockStore.state.mode).toBe("pinned");
	});

	it("openSheet is a no-op when already pinned (pinning wins)", () => {
		chatDockStore.setState(() => ({ mode: "pinned", pendingPrompt: null }));
		chatDock.openSheet();
		expect(chatDockStore.state.mode).toBe("pinned");
	});

	it("startWith pins and queues a prompt with autoSend by default", () => {
		chatDock.startWith("teach me PERT");
		expect(chatDockStore.state.mode).toBe("pinned");
		expect(chatDockStore.state.pendingPrompt).toEqual({
			text: "teach me PERT",
			autoSend: true,
		});
	});

	it("startWith honors autoSend: false", () => {
		chatDock.startWith("draft a breakdown", { autoSend: false });
		expect(chatDockStore.state.pendingPrompt).toEqual({
			text: "draft a breakdown",
			autoSend: false,
		});
	});

	it("consumePendingPrompt returns the prompt once and clears it", () => {
		chatDock.startWith("hello");
		const first = chatDock.consumePendingPrompt();
		expect(first).toEqual({ text: "hello", autoSend: true });
		expect(chatDockStore.state.pendingPrompt).toBeNull();
		const second = chatDock.consumePendingPrompt();
		expect(second).toBeNull();
	});

	it("consumePendingPrompt leaves mode untouched", () => {
		chatDock.startWith("hi");
		chatDock.consumePendingPrompt();
		expect(chatDockStore.state.mode).toBe("pinned");
	});
});

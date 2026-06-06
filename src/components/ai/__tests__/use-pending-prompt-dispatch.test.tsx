// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { usePendingPromptDispatch } from "#/components/ai/chat-panel";
import { chatDockStore } from "#/lib/chat-dock";

// Regression coverage for the tutorial "What is PERT?" flow: clicking a seed
// queues a dock prompt then navigates into a brand-new project whose scope has
// no thread yet. The dispatch must create a thread first and only consume +
// send the prompt once a ChatThread API is available — never drop it.

type Api = {
	sendMessage: Mock<(text: string) => void>;
	setInput: Mock<(text: string) => void>;
};

function makeApi(): Api {
	return {
		sendMessage: vi.fn<(text: string) => void>(),
		setInput: vi.fn<(text: string) => void>(),
	};
}

function seedPending(text: string, autoSend = true) {
	chatDockStore.setState(() => ({
		mode: "pinned",
		pendingPrompt: { text, autoSend },
	}));
	return chatDockStore.state.pendingPrompt;
}

describe("usePendingPromptDispatch", () => {
	beforeEach(() => {
		chatDockStore.setState(() => ({ mode: "closed", pendingPrompt: null }));
	});

	it("does nothing when there's no pending prompt", () => {
		const api = makeApi();
		const onCreateThread = vi.fn();
		renderHook(() =>
			usePendingPromptDispatch({
				pending: null,
				activeThreadId: "t1",
				apiRef: { current: api },
				onCreateThread,
			}),
		);
		expect(onCreateThread).not.toHaveBeenCalled();
		expect(api.sendMessage).not.toHaveBeenCalled();
	});

	it("creates a thread (and keeps the prompt) when the scope is empty", () => {
		const pending = seedPending("teach me PERT");
		const api = makeApi();
		const onCreateThread = vi.fn();
		renderHook(() =>
			usePendingPromptDispatch({
				pending,
				activeThreadId: null,
				apiRef: { current: null },
				onCreateThread,
			}),
		);
		// Thread requested, but prompt must NOT be consumed or sent yet — this is
		// exactly the bug: previously the prompt was cleared and lost here.
		expect(onCreateThread).toHaveBeenCalledTimes(1);
		expect(api.sendMessage).not.toHaveBeenCalled();
		expect(chatDockStore.state.pendingPrompt).toEqual(pending);
	});

	it("auto-sends and consumes once a thread + API are available", () => {
		const pending = seedPending("teach me PERT");
		const api = makeApi();
		renderHook(() =>
			usePendingPromptDispatch({
				pending,
				activeThreadId: "t1",
				apiRef: { current: api },
				onCreateThread: vi.fn(),
			}),
		);
		expect(api.sendMessage).toHaveBeenCalledWith("teach me PERT");
		expect(api.setInput).not.toHaveBeenCalled();
		expect(chatDockStore.state.pendingPrompt).toBeNull();
	});

	it("sets the input instead of sending when autoSend is false", () => {
		const pending = seedPending("draft a breakdown", false);
		const api = makeApi();
		renderHook(() =>
			usePendingPromptDispatch({
				pending,
				activeThreadId: "t1",
				apiRef: { current: api },
				onCreateThread: vi.fn(),
			}),
		);
		expect(api.setInput).toHaveBeenCalledWith("draft a breakdown");
		expect(api.sendMessage).not.toHaveBeenCalled();
		expect(chatDockStore.state.pendingPrompt).toBeNull();
	});

	it("sends after the empty scope fills in (create → thread mounts → send)", () => {
		const pending = seedPending("teach me PERT");
		const apiRef: { current: Api | null } = { current: null };
		const onCreateThread = vi.fn();

		const { rerender } = renderHook(
			(props) => usePendingPromptDispatch(props),
			{
				initialProps: {
					pending,
					activeThreadId: null as string | null,
					apiRef,
					onCreateThread,
				},
			},
		);
		// First commit: empty scope → thread requested, nothing sent.
		expect(onCreateThread).toHaveBeenCalledTimes(1);
		expect(chatDockStore.state.pendingPrompt).toEqual(pending);

		// The new thread mounts and registers its API; activeThreadId fills in.
		apiRef.current = makeApi();
		rerender({ pending, activeThreadId: "t1", apiRef, onCreateThread });

		expect(apiRef.current?.sendMessage).toHaveBeenCalledWith("teach me PERT");
		expect(chatDockStore.state.pendingPrompt).toBeNull();
	});

	it("is idempotent — a re-run with a stale prompt does not send twice", () => {
		const pending = seedPending("teach me PERT");
		const api = makeApi();
		const apiRef = { current: api };

		const { rerender } = renderHook(
			(props) => usePendingPromptDispatch(props),
			{
				initialProps: {
					pending,
					activeThreadId: "t1",
					apiRef,
					onCreateThread: vi.fn(),
				},
			},
		);
		// First run consumes + sends.
		expect(api.sendMessage).toHaveBeenCalledTimes(1);
		expect(chatDockStore.state.pendingPrompt).toBeNull();

		// Force the effect to re-run while the closed-over `pending` is still the
		// (now-stale) prompt — e.g. a StrictMode double-mount or any later dep
		// change. The store is already empty, so consumePendingPrompt() returns
		// null and nothing is sent again.
		rerender({
			pending,
			activeThreadId: "t1",
			apiRef,
			onCreateThread: vi.fn(),
		});
		expect(api.sendMessage).toHaveBeenCalledTimes(1);
	});
});

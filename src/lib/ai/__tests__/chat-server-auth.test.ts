import { describe, expect, it, vi } from "vitest";

// Stub auth + provider + dotenv + tanstack-ai so we can probe just the auth
// gate at the top of `handleChatRequest` without booting Better Auth or
// hitting an LLM. The point of this test is to lock in the "401 before any
// chat work happens" invariant — if a future refactor moves the auth check
// down past `chatParamsFromRequest` or `selectTextAdapter`, the test fails.

const requireSessionFromHeadersMock = vi.fn();
const chatParamsFromRequestMock = vi.fn();
const selectTextAdapterMock = vi.fn();

vi.mock("#/server/auth-context.server", () => ({
	requireSessionFromHeaders: (...args: unknown[]) =>
		requireSessionFromHeadersMock(...args),
}));
vi.mock("@tanstack/ai", () => ({
	chat: vi.fn(),
	chatParamsFromRequest: (...args: unknown[]) =>
		chatParamsFromRequestMock(...args),
	mergeAgentTools: vi.fn(() => []),
	toServerSentEventsResponse: vi.fn(() => new Response("ok", { status: 200 })),
}));
vi.mock("#/lib/ai/provider", () => ({
	selectTextAdapter: (...args: unknown[]) => selectTextAdapterMock(...args),
}));
vi.mock("dotenv", () => ({ default: { config: () => ({ parsed: {} }) } }));

const { handleChatRequest } = await import("#/lib/ai/chat.server");

describe("handleChatRequest auth gate", () => {
	it("returns 401 when the session lookup throws (no cookie / bad cookie)", async () => {
		requireSessionFromHeadersMock.mockRejectedValueOnce(
			new Error("Unauthorized"),
		);
		const res = await handleChatRequest(
			new Request("http://x/api/chat", { method: "POST", body: "{}" }),
		);
		expect(res.status).toBe(401);
		// No chat work should have happened.
		expect(chatParamsFromRequestMock).not.toHaveBeenCalled();
		expect(selectTextAdapterMock).not.toHaveBeenCalled();
	});

	it("proceeds when a session is present", async () => {
		requireSessionFromHeadersMock.mockResolvedValueOnce({
			userId: "u1",
			email: "a@b.c",
			name: "Ada",
			isAdmin: false,
		});
		chatParamsFromRequestMock.mockResolvedValueOnce({
			messages: [],
			tools: [],
		});
		selectTextAdapterMock.mockReturnValueOnce({
			adapter: {},
			config: { provider: "anthropic", model: "claude-opus" },
		});
		const res = await handleChatRequest(
			new Request("http://x/api/chat", { method: "POST", body: "{}" }),
		);
		expect(res.status).toBe(200);
		expect(chatParamsFromRequestMock).toHaveBeenCalledTimes(1);
		expect(selectTextAdapterMock).toHaveBeenCalledTimes(1);
	});
});

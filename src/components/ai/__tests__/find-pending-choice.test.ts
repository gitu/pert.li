import { describe, expect, it } from "vitest";
import {
	type ChatMessage,
	findPendingChoice,
} from "#/components/ai/chat-panel";

// Builds a minimal ChatMessage. Real messages from `useChat` carry extra
// fields we don't care about for these tests — the function only reads
// `role` and `parts`, so plain literals are fine.
function msg(
	role: "user" | "assistant",
	parts: ChatMessage["parts"],
	id = String(Math.random()),
): ChatMessage {
	return { id, role, parts };
}

function askChoicePart(
	args: Record<string, unknown>,
	opts: { id?: string } = {},
) {
	return {
		type: "tool-call",
		name: "ask_choice",
		id: opts.id ?? "tc_default",
		arguments: JSON.stringify(args),
	};
}

describe("findPendingChoice", () => {
	it("returns the call when it follows the latest user message", () => {
		const messages: ChatMessage[] = [
			msg("user", [{ type: "text", content: "teach me PERT" }]),
			msg("assistant", [
				askChoicePart({
					question: "Ready for an example?",
					options: [{ label: "Yes" }, { label: "Skip ahead" }],
				}),
			]),
		];
		const pending = findPendingChoice(messages);
		expect(pending).not.toBeNull();
		expect(pending?.question).toBe("Ready for an example?");
		expect(pending?.options).toEqual([
			{ label: "Yes", value: undefined },
			{ label: "Skip ahead", value: undefined },
		]);
	});

	it("returns null when the user already answered (newer user msg)", () => {
		const messages: ChatMessage[] = [
			msg("user", [{ type: "text", content: "teach me PERT" }]),
			msg("assistant", [
				askChoicePart({
					question: "Ready?",
					options: [{ label: "Yes" }, { label: "No" }],
				}),
			]),
			msg("user", [{ type: "text", content: "Yes" }]),
		];
		expect(findPendingChoice(messages)).toBeNull();
	});

	it("returns the most recent ask_choice when the model re-asked", () => {
		const messages: ChatMessage[] = [
			msg("user", [{ type: "text", content: "teach me PERT" }]),
			msg("assistant", [
				askChoicePart(
					{
						question: "First version",
						options: [{ label: "A" }, { label: "B" }],
					},
					{ id: "tc_old" },
				),
			]),
			msg("assistant", [
				askChoicePart(
					{
						question: "Updated version",
						options: [{ label: "X" }, { label: "Y" }],
					},
					{ id: "tc_new" },
				),
			]),
		];
		const pending = findPendingChoice(messages);
		expect(pending?.toolCallId).toBe("tc_new");
		expect(pending?.question).toBe("Updated version");
	});

	it("ignores other tool calls", () => {
		const messages: ChatMessage[] = [
			msg("user", [{ type: "text", content: "summarize" }]),
			msg("assistant", [
				{
					type: "tool-call",
					name: "read_project",
					id: "tc_read",
					arguments: "{}",
				},
			]),
		];
		expect(findPendingChoice(messages)).toBeNull();
	});

	it("returns null when arguments are malformed JSON", () => {
		const messages: ChatMessage[] = [
			msg("user", [{ type: "text", content: "hi" }]),
			msg("assistant", [
				{
					type: "tool-call",
					name: "ask_choice",
					id: "tc_bad",
					arguments: "{not json",
				},
			]),
		];
		expect(findPendingChoice(messages)).toBeNull();
	});

	it("preserves option `value` when provided", () => {
		const messages: ChatMessage[] = [
			msg("user", [{ type: "text", content: "go" }]),
			msg("assistant", [
				askChoicePart({
					question: "Pick a unit",
					options: [
						{ label: "Hours", value: "Use hours as the unit" },
						{ label: "Days" },
					],
				}),
			]),
		];
		const pending = findPendingChoice(messages);
		expect(pending?.options[0]).toEqual({
			label: "Hours",
			value: "Use hours as the unit",
		});
		expect(pending?.options[1]).toEqual({ label: "Days", value: undefined });
	});

	it("returns null when there are no messages at all", () => {
		expect(findPendingChoice([])).toBeNull();
	});

	it("works when there is no user message yet (initial prompt seeded by UI)", () => {
		const messages: ChatMessage[] = [
			msg("assistant", [
				askChoicePart({
					question: "How shall we start?",
					options: [{ label: "Intro" }, { label: "Jump in" }],
				}),
			]),
		];
		// lastUserIdx === -1 means the scanner walks the whole array — the call
		// still counts as pending because nothing has resolved it.
		expect(findPendingChoice(messages)?.question).toBe("How shall we start?");
	});
});

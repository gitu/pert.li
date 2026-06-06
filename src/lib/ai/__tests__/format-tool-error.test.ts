import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatToolError } from "#/lib/ai/format-tool-error";

describe("formatToolError", () => {
	// Real error strings produced by the operation handlers / tool layer map to
	// a friendly sentence. The id/value in the raw message is dynamic, so each
	// case uses a representative instance.
	const cases: Array<[string, string]> = [
		["task abc123 not found", "I couldn't find that task"],
		["task id m2 already exists", "already exists"],
		["dependency dep_7 not found", "That dependency no longer exists."],
		[
			"interface if_3 not found on c1",
			"That connection point no longer exists.",
		],
		["container c9 not found", "I couldn't find that container"],
		["parent p1 is not a container", "That target isn't a container."],
		["self-dependency is not allowed", "A task can't depend on itself."],
		[
			"cannot depend on container c1 — pick a specific leaf inside it",
			"pick a specific task inside it",
		],
		[
			"move would create a cycle in the hierarchy",
			"would create a dependency loop",
		],
		[
			"optimistic must be <= mostLikely",
			"optimistic ≤ most likely ≤ pessimistic",
		],
		["actualFinish must be ISO yyyy-mm-dd", "That date isn't valid"],
		["no work plan exists — create one first", "There's no work plan yet"],
		["set_estimate crashed: boom", "Something went wrong running that step"],
		["Not valid JSON: unexpected token", "wasn't in the expected format"],
	];

	it.each(cases)("maps %j to a friendly message", (raw, expectedFragment) => {
		expect(formatToolError(raw)).toContain(expectedFragment);
	});

	it("falls back to a generic message for empty/missing input", () => {
		expect(formatToolError("")).toBe("Something went wrong.");
		expect(formatToolError(undefined)).toBe("Something went wrong.");
		expect(formatToolError(null)).toBe("Something went wrong.");
		expect(formatToolError("   ")).toBe("Something went wrong.");
	});

	it("returns unrecognised, non-empty errors unchanged (never swallows them)", () => {
		const novel = "some brand new error the mapper has never seen";
		expect(formatToolError(novel)).toBe(novel);
	});

	it("property: output is always a non-empty string", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const out = formatToolError(raw);
				return typeof out === "string" && out.length > 0;
			}),
		);
	});

	it("property: an unmatched string is echoed back verbatim (trimmed)", () => {
		fc.assert(
			fc.property(
				// Avoid any keyword that a rule would match; plain alphanumerics
				// with no spaces can't hit the keyword regexes.
				fc.stringMatching(/^[a-z0-9]{1,40}$/),
				(raw) => formatToolError(raw) === raw,
			),
		);
	});
});

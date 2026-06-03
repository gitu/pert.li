import { describe, expect, it } from "vitest";
import { clip } from "../chat-debug.server";

// clip() runs inside the chat stream wrapper — a throw here would take down
// the chat response, not just the trace line, so it must never throw.

describe("clip", () => {
	it("passes short strings through unchanged", () => {
		expect(clip("hello")).toBe("hello");
	});

	it("truncates long values with a length marker", () => {
		const long = "x".repeat(3000);
		const clipped = clip(long, 100);
		expect(clipped.length).toBeLessThan(200);
		expect(clipped).toContain("…[+");
	});

	it("stringifies objects", () => {
		expect(clip({ a: 1 })).toBe('{"a":1}');
	});

	it("does not throw on circular structures", () => {
		const circular: Record<string, unknown> = { name: "loop" };
		circular.self = circular;
		expect(() => clip(circular)).not.toThrow();
		expect(clip(circular)).toContain("Object");
	});

	it("does not throw on BigInt values", () => {
		expect(() => clip({ big: 1n })).not.toThrow();
	});

	it("returns an empty string for undefined", () => {
		expect(clip(undefined)).toBe("");
	});
});

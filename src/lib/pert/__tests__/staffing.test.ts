import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ResolvedStaffing } from "../resolve-scheduling";
import { crashDuration, crashDurations, peopleForDuration } from "../staffing";

const ON = (over: Partial<ResolvedStaffing> = {}): ResolvedStaffing => ({
	enabled: true,
	levelDays: 5,
	maxPerTask: 4,
	...over,
});

const OFF: ResolvedStaffing = { enabled: false, levelDays: 5, maxPerTask: 4 };

describe("peopleForDuration", () => {
	it("is 1 when staffing is disabled, whatever the size", () => {
		expect(peopleForDuration(100, OFF)).toBe(1);
	});

	it("chunks one person per level, capped at maxPerTask", () => {
		const s = ON({ levelDays: 5, maxPerTask: 4 });
		expect(peopleForDuration(4, s)).toBe(1); // below level
		expect(peopleForDuration(5, s)).toBe(1); // exactly one chunk → still 1
		expect(peopleForDuration(9, s)).toBe(1); // 1.8 chunks → floor 1
		expect(peopleForDuration(10, s)).toBe(2); // 2 chunks
		expect(peopleForDuration(19.9, s)).toBe(3); // floor(3.98)=3
		expect(peopleForDuration(20, s)).toBe(4); // 4 chunks → cap
		expect(peopleForDuration(1000, s)).toBe(4); // cap holds
	});

	it("boundary: a 2nd person only appears at size ≥ 2·level", () => {
		const s = ON({ levelDays: 3, maxPerTask: 5 });
		expect(peopleForDuration(5.9, s)).toBe(1);
		expect(peopleForDuration(6, s)).toBe(2);
	});

	it("no-ops: maxPerTask=1, levelDays≤0, size≤0", () => {
		expect(peopleForDuration(100, ON({ maxPerTask: 1 }))).toBe(1);
		expect(peopleForDuration(100, ON({ levelDays: 0 }))).toBe(1);
		expect(peopleForDuration(100, ON({ levelDays: -3 }))).toBe(1);
		expect(peopleForDuration(0, ON())).toBe(1);
		expect(peopleForDuration(-4, ON())).toBe(1);
	});

	it("property: always within [1, maxPerTask] and non-decreasing in size", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
				fc.double({ min: 0.5, max: 50, noNaN: true, noDefaultInfinity: true }),
				fc.integer({ min: 1, max: 12 }),
				(size, level, max) => {
					const s = ON({ levelDays: level, maxPerTask: max });
					const k = peopleForDuration(size, s);
					expect(k).toBeGreaterThanOrEqual(1);
					expect(k).toBeLessThanOrEqual(max);
					// Monotonic: a bigger task never gets fewer people.
					expect(peopleForDuration(size + level, s)).toBeGreaterThanOrEqual(k);
				},
			),
		);
	});
});

describe("crashDuration", () => {
	it("divides the value by the people count", () => {
		const s = ON({ levelDays: 5, maxPerTask: 4 });
		// 20d task → 4 people → 5d.
		expect(crashDuration(20, 20, s)).toBeCloseTo(5, 9);
		// in-progress: size 20 (4 people) but only 10 remaining → 2.5d.
		expect(crashDuration(20, 10, s)).toBeCloseTo(2.5, 9);
	});

	it("returns 0 for non-positive value (milestones, completed)", () => {
		expect(crashDuration(20, 0, ON())).toBe(0);
		expect(crashDuration(0, 0, ON())).toBe(0);
	});

	it("property: crashed ∈ [value/maxPerTask, value]", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0.1, max: 500, noNaN: true, noDefaultInfinity: true }),
				fc.double({ min: 0.5, max: 50, noNaN: true, noDefaultInfinity: true }),
				fc.integer({ min: 1, max: 12 }),
				(value, level, max) => {
					const s = ON({ levelDays: level, maxPerTask: max });
					const crashed = crashDuration(value, value, s);
					expect(crashed).toBeLessThanOrEqual(value + 1e-9);
					expect(crashed).toBeGreaterThanOrEqual(value / max - 1e-9);
				},
			),
		);
	});
});

describe("crashDurations", () => {
	it("returns the value map untouched when disabled", () => {
		const value = { a: 10, b: 20 };
		expect(crashDurations(value, value, OFF)).toBe(value);
	});

	it("crashes per-task using sizing for k and value for division", () => {
		const s = ON({ levelDays: 5, maxPerTask: 4 });
		const sizing = { a: 20, b: 4 };
		const value = { a: 20, b: 4 };
		const out = crashDurations(sizing, value, s);
		expect(out.a).toBeCloseTo(5, 9); // 20 → 4 people
		expect(out.b).toBeCloseTo(4, 9); // below level → 1 person
	});

	it("falls back to value as sizing when sizing key is missing", () => {
		const s = ON({ levelDays: 5, maxPerTask: 4 });
		const out = crashDurations({}, { a: 20 }, s);
		expect(out.a).toBeCloseTo(5, 9);
	});
});

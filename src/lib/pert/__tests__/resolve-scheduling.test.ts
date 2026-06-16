import { describe, expect, it } from "vitest";
import {
	DEFAULT_RESOLVED_STAFFING,
	DEFAULT_SCHEDULE_BASIS,
	MIN_STAFFING_LEVEL_DAYS,
	resolveScheduling,
	resolveStaffing,
} from "../resolve-scheduling";
import type { PertDoc } from "../types";

describe("resolveScheduling", () => {
	it("fills defaults for an undefined doc / missing config", () => {
		expect(resolveScheduling(undefined)).toEqual({
			basis: DEFAULT_SCHEDULE_BASIS,
			staffing: DEFAULT_RESOLVED_STAFFING,
		});
		expect(resolveScheduling({} as PertDoc).basis).toBe("expected");
	});

	it("passes through a valid basis", () => {
		expect(
			resolveScheduling({ scheduling: { basis: "most-likely" } }).basis,
		).toBe("most-likely");
	});

	it("falls back to default for an unknown basis (forward-compat)", () => {
		expect(
			resolveScheduling({
				scheduling: { basis: "p50" as unknown as "expected" },
			}).basis,
		).toBe("expected");
	});
});

describe("resolveStaffing", () => {
	it("returns disabled defaults when absent", () => {
		expect(resolveStaffing(undefined)).toEqual(DEFAULT_RESOLVED_STAFFING);
	});

	it("clamps levelDays to a positive minimum", () => {
		expect(
			resolveStaffing({ enabled: true, levelDays: 0, maxPerTask: 3 }).levelDays,
		).toBeGreaterThanOrEqual(MIN_STAFFING_LEVEL_DAYS);
		expect(
			resolveStaffing({ enabled: true, levelDays: -5, maxPerTask: 3 })
				.levelDays,
		).toBeGreaterThanOrEqual(MIN_STAFFING_LEVEL_DAYS);
		expect(
			resolveStaffing({
				enabled: true,
				levelDays: Number.NaN,
				maxPerTask: 3,
			}).levelDays,
		).toBeGreaterThanOrEqual(MIN_STAFFING_LEVEL_DAYS);
	});

	it("rounds maxPerTask to an integer ≥ 1", () => {
		expect(
			resolveStaffing({ enabled: true, levelDays: 5, maxPerTask: 0 })
				.maxPerTask,
		).toBe(1);
		expect(
			resolveStaffing({ enabled: true, levelDays: 5, maxPerTask: 3.7 })
				.maxPerTask,
		).toBe(4);
		expect(
			resolveStaffing({ enabled: true, levelDays: 5, maxPerTask: -2 })
				.maxPerTask,
		).toBe(1);
	});

	it("coerces enabled to a strict boolean", () => {
		expect(
			resolveStaffing({
				enabled: 1 as unknown as boolean,
				levelDays: 5,
				maxPerTask: 3,
			}).enabled,
		).toBe(false);
		expect(
			resolveStaffing({ enabled: true, levelDays: 5, maxPerTask: 3 }).enabled,
		).toBe(true);
	});
});

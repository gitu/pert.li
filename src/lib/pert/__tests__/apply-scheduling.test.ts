import { describe, expect, it } from "vitest";
import { applyScheduling } from "../apply-scheduling";
import {
	DEFAULT_STAFFING_LEVEL_DAYS,
	DEFAULT_STAFFING_MAX_PER_TASK,
} from "../resolve-scheduling";
import type { PertDoc } from "../types";
import { createEmptyPertDoc } from "../types";

function fakeChange(doc: PertDoc) {
	return (mutate: (d: PertDoc) => void) => mutate(doc);
}

const DEFAULT_STAFFING = {
	enabled: false,
	levelDays: DEFAULT_STAFFING_LEVEL_DAYS,
	maxPerTask: DEFAULT_STAFFING_MAX_PER_TASK,
};

describe("applyScheduling", () => {
	it("leaves no trace when everything is default", () => {
		const doc = createEmptyPertDoc("t");
		applyScheduling(fakeChange(doc), {
			basis: "expected",
			parallelStaffing: DEFAULT_STAFFING,
		});
		expect(doc.scheduling).toBeUndefined();
	});

	it("persists only a non-default basis", () => {
		const doc = createEmptyPertDoc("t");
		applyScheduling(fakeChange(doc), {
			basis: "most-likely",
			parallelStaffing: DEFAULT_STAFFING,
		});
		expect(doc.scheduling).toEqual({ basis: "most-likely" });
	});

	it("persists customised staffing (including disabled-but-customised)", () => {
		const doc = createEmptyPertDoc("t");
		applyScheduling(fakeChange(doc), {
			basis: "expected",
			parallelStaffing: { enabled: true, levelDays: 10, maxPerTask: 5 },
		});
		expect(doc.scheduling).toEqual({
			parallelStaffing: { enabled: true, levelDays: 10, maxPerTask: 5 },
		});

		const doc2 = createEmptyPertDoc("t");
		applyScheduling(fakeChange(doc2), {
			basis: "expected",
			parallelStaffing: { enabled: false, levelDays: 10, maxPerTask: 5 },
		});
		expect(doc2.scheduling?.parallelStaffing).toEqual({
			enabled: false,
			levelDays: 10,
			maxPerTask: 5,
		});
	});

	it("clears prior config when re-saved at defaults", () => {
		const doc = createEmptyPertDoc("t");
		doc.scheduling = {
			basis: "most-likely",
			parallelStaffing: { enabled: true, levelDays: 8, maxPerTask: 2 },
		};
		applyScheduling(fakeChange(doc), {
			basis: "expected",
			parallelStaffing: DEFAULT_STAFFING,
		});
		expect(doc.scheduling).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import { applyCalendar } from "../apply-calendar";
import { DEFAULT_WORKING_DAYS } from "../calendar";
import type { PertDoc } from "../types";
import { createEmptyPertDoc } from "../types";

// A synchronous stand-in for Automerge's changeDoc that applies the mutation
// to a plain object — enough to assert the merge result.
function fakeChange(doc: PertDoc) {
	return (mutate: (d: PertDoc) => void) => mutate(doc);
}

describe("applyCalendar", () => {
	it("writes the calendar with team capacity", () => {
		const doc = createEmptyPertDoc("t");
		applyCalendar(fakeChange(doc), {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3],
			allocationMode: "team",
			team: { peopleCount: 3, availabilityPct: 80, useHistoric: true },
		});
		expect(doc.calendar).toEqual({
			startDate: "2026-01-05",
			workingDays: [1, 2, 3],
			allocationMode: "team",
			team: { peopleCount: 3, availabilityPct: 80, useHistoric: true },
		});
	});

	it("falls back to default working days when none are selected", () => {
		const doc = createEmptyPertDoc("t");
		applyCalendar(fakeChange(doc), {
			startDate: "2026-01-05",
			workingDays: [],
			allocationMode: "calendar",
			team: { peopleCount: 1, availabilityPct: 100 },
		});
		expect(doc.calendar?.workingDays).toEqual(DEFAULT_WORKING_DAYS);
	});

	it("omits useHistoric when false and preserves existing holidays", () => {
		const doc = createEmptyPertDoc("t");
		doc.calendar = {
			startDate: "2025-01-01",
			workingDays: [1, 2, 3, 4, 5],
			holidays: ["2026-12-25"],
		};
		applyCalendar(fakeChange(doc), {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "calendar",
			team: { peopleCount: 2, availabilityPct: 100, useHistoric: false },
		});
		expect(doc.calendar?.holidays).toEqual(["2026-12-25"]);
		expect("useHistoric" in (doc.calendar?.team ?? {})).toBe(false);
	});
});

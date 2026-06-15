import * as Automerge from "@automerge/automerge";
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

	it("carries estimateBasis through and omits it when absent", () => {
		const doc = createEmptyPertDoc("t");
		applyCalendar(fakeChange(doc), {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 3, availabilityPct: 80, estimateBasis: "duration" },
		});
		expect(doc.calendar?.team?.estimateBasis).toBe("duration");

		const other = createEmptyPertDoc("t2");
		applyCalendar(fakeChange(other), {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			allocationMode: "team",
			team: { peopleCount: 3, availabilityPct: 80 },
		});
		expect("estimateBasis" in (other.calendar?.team ?? {})).toBe(false);
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

	// Regression: the calendar form seeds its state directly from `doc.calendar`,
	// so an unedited `workingDays` / `holidays` is still the live Automerge proxy
	// array. Re-assigning that proxy into the doc throws "Cannot create a
	// reference to an existing document object" — applyCalendar must clone it.
	// (Repro: in team mode, change only People and Save → crash, no save.)
	it("re-saves an Automerge-backed calendar without throwing when arrays are unchanged", () => {
		let doc = Automerge.from<PertDoc>(createEmptyPertDoc("t"));
		doc = Automerge.change(doc, (d) => {
			d.calendar = {
				startDate: "2026-01-01",
				workingDays: [1, 2, 3, 4, 5],
				holidays: ["2026-12-25"],
			};
		});

		expect(() => {
			doc = Automerge.change(doc, (d) => {
				// Pass the live proxy arrays back, exactly as the form does when the
				// user changes only the team size and leaves the days untouched.
				applyCalendar((fn) => fn(d), {
					startDate: d.calendar?.startDate ?? "2026-01-01",
					workingDays: d.calendar?.workingDays ?? [],
					allocationMode: "team",
					team: { peopleCount: 4, availabilityPct: 100 },
				});
			});
		}).not.toThrow();

		expect(doc.calendar?.team?.peopleCount).toBe(4);
		expect([...(doc.calendar?.workingDays ?? [])]).toEqual([1, 2, 3, 4, 5]);
		expect([...(doc.calendar?.holidays ?? [])]).toEqual(["2026-12-25"]);
	});
});

import { describe, expect, it } from "vitest";
import {
	addWorkingDays,
	dayOffsetToDate,
	effectiveCalendar,
	parseIsoDate,
	toIsoDate,
} from "../calendar";

describe("calendar helpers", () => {
	it("rounds dayOffsetToDate up to the next working day", () => {
		// 2026-01-05 is a Monday.
		const cal = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
		};
		expect(dayOffsetToDate(0, cal)).toBe("2026-01-05");
		expect(dayOffsetToDate(1, cal)).toBe("2026-01-06");
		// Friday + 1 working day = next Monday.
		expect(dayOffsetToDate(5, cal)).toBe("2026-01-12");
	});

	it("skips weekends when adding working days", () => {
		const cal = {
			startDate: "2026-01-09", // Friday
			workingDays: [1, 2, 3, 4, 5],
		};
		expect(addWorkingDays("2026-01-09", 0, cal)).toBe("2026-01-09");
		expect(addWorkingDays("2026-01-09", 1, cal)).toBe("2026-01-12"); // Mon
	});

	it("skips holidays", () => {
		const cal = {
			startDate: "2026-01-05",
			workingDays: [1, 2, 3, 4, 5],
			holidays: ["2026-01-06"],
		};
		expect(addWorkingDays("2026-01-05", 1, cal)).toBe("2026-01-07");
	});

	it("treats Saturday as working when configured", () => {
		const cal = {
			startDate: "2026-01-09", // Friday
			workingDays: [1, 2, 3, 4, 5, 6],
		};
		expect(addWorkingDays("2026-01-09", 1, cal)).toBe("2026-01-10");
	});

	it("falls back to today and Mon–Fri when calendar is undefined", () => {
		const { workingDays } = effectiveCalendar(undefined);
		expect(workingDays).toEqual([1, 2, 3, 4, 5]);
	});

	it("round-trips ISO dates through Date", () => {
		const d = parseIsoDate("2026-05-25");
		expect(d).not.toBeNull();
		expect(toIsoDate(d as Date)).toBe("2026-05-25");
	});

	it("rejects malformed ISO strings", () => {
		expect(parseIsoDate("not-a-date")).toBeNull();
	});
});

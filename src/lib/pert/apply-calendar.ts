import { DEFAULT_WORKING_DAYS } from "./calendar";
import type {
	AllocationMode,
	PertDoc,
	ProjectCalendar,
	TeamCapacity,
} from "./types";

// The payload ProjectCalendarForm emits via onSave.
export type CalendarFormResult = {
	startDate: string;
	workingDays: number[];
	allocationMode: AllocationMode;
	team: TeamCapacity;
};

// Merge a calendar-form result back into the doc. Shared by the header sheet
// and the Overview tab so the two entry points stay byte-for-byte identical.
// Automerge rejects `undefined` assignments, so `holidays` is only carried
// forward when the previous calendar actually had one.
export function applyCalendar(
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	next: CalendarFormResult,
): void {
	changeDoc((d) => {
		const previousHolidays = d.calendar?.holidays;
		const calendar: ProjectCalendar = {
			startDate: next.startDate,
			workingDays:
				next.workingDays.length > 0 ? next.workingDays : DEFAULT_WORKING_DAYS,
			allocationMode: next.allocationMode,
			team: {
				peopleCount: next.team.peopleCount,
				availabilityPct: next.team.availabilityPct,
				...(next.team.useHistoric ? { useHistoric: true } : {}),
			},
		};
		if (previousHolidays) calendar.holidays = previousHolidays;
		d.calendar = calendar;
	});
}

import type { ProjectCalendar } from "./types";

// Calendar / working-day helpers. The schedule engine produces durations in
// "project days"; this module converts those offsets into actual ISO dates by
// respecting `workingDays` (1=Mon … 7=Sun) and optional `holidays`.

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

export function todayIsoDate(): string {
	return toIsoDate(new Date());
}

export function toIsoDate(date: Date): string {
	const y = date.getUTCFullYear();
	const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
	const d = `${date.getUTCDate()}`.padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
	const [y, m, d] = iso.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	if (Number.isNaN(date.getTime())) return null;
	return date;
}

export function effectiveCalendar(cal: ProjectCalendar | undefined): {
	startDate: string;
	workingDays: number[];
	holidaySet: Set<string>;
} {
	const startDate = cal?.startDate ?? todayIsoDate();
	const workingDays =
		cal?.workingDays && cal.workingDays.length > 0
			? Array.from(new Set(cal.workingDays))
			: DEFAULT_WORKING_DAYS;
	const holidaySet = new Set(cal?.holidays ?? []);
	return { startDate, workingDays, holidaySet };
}

// ISO weekday: 1=Mon … 7=Sun.
function isoWeekday(date: Date): number {
	const js = date.getUTCDay();
	return js === 0 ? 7 : js;
}

function isWorking(
	date: Date,
	workingDaysSet: Set<number>,
	holidaySet: Set<string>,
): boolean {
	if (!workingDaysSet.has(isoWeekday(date))) return false;
	if (holidaySet.has(toIsoDate(date))) return false;
	return true;
}

// Add `workingDays` to a starting calendar date. A 0-offset returns the start
// date itself if it's a working day, otherwise advances to the next working
// day — same convention every PM tool uses.
export function addWorkingDays(
	startIso: string,
	workingDays: number,
	cal: ProjectCalendar | undefined,
): string {
	const start = parseIsoDate(startIso);
	if (!start) return startIso;
	const { workingDays: wd, holidaySet } = effectiveCalendar(cal);
	const wdSet = new Set(wd);
	if (wdSet.size === 0) return startIso;

	const offset = Math.max(0, Math.floor(workingDays));
	let cursor = new Date(start.getTime());
	while (!isWorking(cursor, wdSet, holidaySet)) {
		cursor = new Date(cursor.getTime() + DAY_MS);
	}
	let remaining = offset;
	while (remaining > 0) {
		cursor = new Date(cursor.getTime() + DAY_MS);
		if (isWorking(cursor, wdSet, holidaySet)) remaining -= 1;
	}
	return toIsoDate(cursor);
}

// Convert a "day offset" produced by the engine (where 0 = project start) into
// a calendar date. Fractional offsets round up — partial days still consume a
// full working day on the calendar.
export function dayOffsetToDate(
	offset: number,
	cal: ProjectCalendar | undefined,
): string {
	const { startDate } = effectiveCalendar(cal);
	const wholeDays = Math.max(0, Math.ceil(offset));
	return addWorkingDays(startDate, wholeDays, cal);
}

// Count of working days inclusive of both endpoints. Used to measure how long
// a completed task actually took for the "historic capacity" estimator.
// Returns 0 when end < start.
export function workingDaysInclusive(
	startIso: string,
	endIso: string,
	cal: ProjectCalendar | undefined,
): number {
	const start = parseIsoDate(startIso);
	const end = parseIsoDate(endIso);
	if (!start || !end) return 0;
	if (end.getTime() < start.getTime()) return 0;
	const { workingDays, holidaySet } = effectiveCalendar(cal);
	const wdSet = new Set(workingDays);
	if (wdSet.size === 0) return 0;
	let count = 0;
	let cursor = new Date(start.getTime());
	while (cursor.getTime() <= end.getTime()) {
		const weekday = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
		const iso = toIsoDate(cursor);
		if (wdSet.has(weekday) && !holidaySet.has(iso)) count += 1;
		cursor = new Date(cursor.getTime() + DAY_MS);
	}
	return count;
}

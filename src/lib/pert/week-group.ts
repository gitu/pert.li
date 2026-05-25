import type { TimelineLane } from "./timeline";

// Mobile-friendly grouping: turn a flat list of timeline lanes into chunks
// keyed by the ISO date of the Monday that starts the lane's "earliest
// finish" week. The mobile timeline view replaces the desktop SVG strip
// with a stack of weekly sections so it reads top-to-bottom on a phone.
//
// Groups are sorted ascending by week start, and lanes within a group keep
// the input order — `buildTimelineModel` already returns them sorted by
// earliestStart/Finish/title, so the per-group order is meaningful.

export type WeekGroup = {
	// ISO date (YYYY-MM-DD) of the Monday that begins the week. Stable key
	// for React lists and sorting.
	weekStart: string;
	lanes: TimelineLane[];
};

export function groupLanesByWeek(lanes: TimelineLane[]): WeekGroup[] {
	const byKey = new Map<string, TimelineLane[]>();
	for (const lane of lanes) {
		const key = mondayOfWeek(lane.earliestFinishDate);
		const bucket = byKey.get(key);
		if (bucket) bucket.push(lane);
		else byKey.set(key, [lane]);
	}
	const groups: WeekGroup[] = [];
	for (const [weekStart, ls] of byKey) groups.push({ weekStart, lanes: ls });
	groups.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
	return groups;
}

// Returns the ISO date (YYYY-MM-DD) of the Monday that begins the ISO week
// containing the given date. Treats the date as UTC midnight to avoid
// timezone drift — every PERT date in the doc is already YYYY-MM-DD.
export function mondayOfWeek(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	// ISO weekday: 1 (Mon) ... 7 (Sun). JS getUTCDay returns 0 (Sun) ... 6 (Sat).
	const jsDay = date.getUTCDay();
	const isoDay = jsDay === 0 ? 7 : jsDay;
	const offset = isoDay - 1;
	date.setUTCDate(date.getUTCDate() - offset);
	return date.toISOString().slice(0, 10);
}

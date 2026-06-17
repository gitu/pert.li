// SCHEDULING-SETTINGS: mutator for the per-project schedule basis +
// parallel-staffing config. Mirrors apply-display.ts: persists ONLY values that
// diverge from their default, so an all-default config leaves no trace
// (`delete d.scheduling`). Automerge rejects `undefined` assignments — we only
// ever assign a concrete object or `delete`. No arrays here, so the
// proxy-clone hazard from apply-calendar.ts doesn't apply.

import {
	DEFAULT_SCHEDULE_BASIS,
	DEFAULT_STAFFING_LEVEL_DAYS,
	DEFAULT_STAFFING_MAX_PER_TASK,
} from "./resolve-scheduling";
import type {
	ParallelStaffing,
	PertDoc,
	ScheduleBasis,
	SchedulingSettings,
} from "./types";

// The payload the scheduling controls emit via onSave.
export type SchedulingFormResult = {
	basis: ScheduleBasis;
	parallelStaffing: ParallelStaffing;
};

// A disabled staffing block sitting at its default level/cap is "no config" —
// don't persist it. A customised-but-disabled block IS kept, so re-enabling
// later restores the user's numbers.
function staffingIsDefault(s: ParallelStaffing): boolean {
	return (
		s.enabled === false &&
		s.levelDays === DEFAULT_STAFFING_LEVEL_DAYS &&
		s.maxPerTask === DEFAULT_STAFFING_MAX_PER_TASK
	);
}

export function writeScheduling(d: PertDoc, next: SchedulingFormResult): void {
	const settings: SchedulingSettings = {};
	if (next.basis !== DEFAULT_SCHEDULE_BASIS) settings.basis = next.basis;
	if (!staffingIsDefault(next.parallelStaffing)) {
		settings.parallelStaffing = {
			enabled: next.parallelStaffing.enabled,
			levelDays: next.parallelStaffing.levelDays,
			maxPerTask: next.parallelStaffing.maxPerTask,
		};
	}
	if (settings.basis === undefined && settings.parallelStaffing === undefined) {
		// Everything is default — leave no trace (and clear any prior config).
		delete d.scheduling;
		return;
	}
	d.scheduling = settings;
}

export function applyScheduling(
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	next: SchedulingFormResult,
): void {
	changeDoc((d) => writeScheduling(d, next));
}

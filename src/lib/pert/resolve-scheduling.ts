// SCHEDULING-SETTINGS: pure registry + resolver, mirroring display.ts. Turns
// the sparse/optional `doc.scheduling` into a TOTAL, clamped shape so every
// consumer (schedule.ts, montecarlo, the form, the inspector hint) reads
// concrete values without `?? default` and without re-validating.
//
// Defense-in-depth clamping lives HERE (not just in the form): the config is
// collaborator-shared and copyable across projects, so a corrupted or
// forward-version value must be normalised on read rather than flow through.

import type {
	ParallelStaffing,
	PertDoc,
	ScheduleBasis,
	SchedulingSettings,
} from "./types";

export const SCHEDULE_BASES: readonly ScheduleBasis[] = [
	"expected",
	"most-likely",
];
export const DEFAULT_SCHEDULE_BASIS: ScheduleBasis = "expected";

// Sane starting points for the staffing form. Disabled by default so existing
// projects are unaffected until someone opts in.
export const DEFAULT_STAFFING_LEVEL_DAYS = 5;
export const DEFAULT_STAFFING_MAX_PER_TASK = 3;
// Floor for levelDays — a non-positive chunk would mean "infinite people".
export const MIN_STAFFING_LEVEL_DAYS = 0.5;

export type ResolvedStaffing = {
	enabled: boolean;
	levelDays: number;
	maxPerTask: number;
};

export type ResolvedScheduling = {
	basis: ScheduleBasis;
	staffing: ResolvedStaffing;
};

export const DEFAULT_RESOLVED_STAFFING: ResolvedStaffing = {
	enabled: false,
	levelDays: DEFAULT_STAFFING_LEVEL_DAYS,
	maxPerTask: DEFAULT_STAFFING_MAX_PER_TASK,
};

function resolveBasis(raw: ScheduleBasis | undefined): ScheduleBasis {
	return raw !== undefined &&
		(SCHEDULE_BASES as readonly string[]).includes(raw)
		? raw
		: DEFAULT_SCHEDULE_BASIS;
}

export function resolveStaffing(
	raw: ParallelStaffing | undefined,
): ResolvedStaffing {
	if (!raw) return DEFAULT_RESOLVED_STAFFING;
	const levelDays =
		Number.isFinite(raw.levelDays) && raw.levelDays >= MIN_STAFFING_LEVEL_DAYS
			? raw.levelDays
			: Math.max(MIN_STAFFING_LEVEL_DAYS, DEFAULT_STAFFING_LEVEL_DAYS);
	const maxPerTask = Number.isFinite(raw.maxPerTask)
		? Math.max(1, Math.round(raw.maxPerTask))
		: DEFAULT_STAFFING_MAX_PER_TASK;
	return {
		enabled: raw.enabled === true,
		levelDays,
		maxPerTask,
	};
}

// Total resolver: fills + clamps every field. Tolerates undefined docs/config.
export function resolveScheduling(
	doc: Pick<PertDoc, "scheduling"> | undefined,
): ResolvedScheduling {
	const scheduling: SchedulingSettings | undefined = doc?.scheduling;
	return {
		basis: resolveBasis(scheduling?.basis),
		staffing: resolveStaffing(scheduling?.parallelStaffing),
	};
}

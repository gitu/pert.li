// PARALLEL-STAFFING: pure math for the "throw more people at a big task" model.
// Dependency-free (type-only import from ./types) so it can be exhaustively
// property-tested, exactly like display.ts.
//
// Model (decided with the user): for a task of size E days, up to `maxPerTask`
// EQUAL people can crash it in parallel with LINEAR speedup → E/k wall-clock.
// People are "chunked" off `levelDays`:
//
//   k = clamp(floor(E / levelDays), 1, maxPerTask)
//
// so `levelDays` doubles as the eligibility threshold (a task below it always
// runs at one person) and the per-person work chunk (each extra `levelDays` of
// size justifies one more body, until the cap). Linear E/k is deliberately
// optimistic — it assumes perfect parallelism with zero coordination cost; the
// UI labels it as such so the forecast isn't read as a promise.

import type { ResolvedStaffing } from "./resolve-scheduling";
import type { TaskId } from "./types";

// How many equal people crash a task of `sizingDays`. Always ≥ 1. Disabled
// staffing, a non-positive `levelDays`, or a too-small task all collapse to 1.
export function peopleForDuration(
	sizingDays: number,
	s: ResolvedStaffing,
): number {
	if (!s.enabled) return 1;
	if (sizingDays <= 0) return 1;
	if (s.levelDays <= 0) return 1;
	const chunks = Math.floor(sizingDays / s.levelDays);
	if (chunks <= 1) return 1;
	return Math.min(chunks, Math.max(1, s.maxPerTask));
}

// Crashed wall-clock duration. `sizingDays` (the task's full planned size)
// decides how many people pile on; `valueDays` (the effective/remaining
// duration) is what actually gets divided. They differ only for in-progress
// tasks — k stays pinned to the full scope while the remaining work shrinks.
export function crashDuration(
	sizingDays: number,
	valueDays: number,
	s: ResolvedStaffing,
): number {
	if (valueDays <= 0) return 0;
	const k = peopleForDuration(sizingDays, s);
	return valueDays / k;
}

// Pointwise transform applied to a whole duration map right before the final
// CPM pass. `sizing` drives k per task; `value` is the map that gets crashed.
// Pass the same map for both when there's no plan/remaining distinction.
export function crashDurations(
	sizing: Record<TaskId, number>,
	value: Record<TaskId, number>,
	s: ResolvedStaffing,
): Record<TaskId, number> {
	if (!s.enabled) return value;
	const out: Record<TaskId, number> = {};
	for (const id of Object.keys(value)) {
		out[id] = crashDuration(sizing[id] ?? value[id], value[id], s);
	}
	return out;
}

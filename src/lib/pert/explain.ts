// EXPLAINERS: pure helpers that turn a task's schedule + estimate into short
// "how was this number calculated?" strings, with the actual operands filled
// in. Centralised so every surface (canvas node, task list, inspector, overview)
// shows the SAME wording for the SAME quantity. Dependency-light (type-only
// imports) so it can be unit-tested in isolation.
//
// All schedule numbers are in project days (0 = project start). Estimates carry
// their own unit; the expected-duration explainer shows the formula in the
// estimate's unit and, when that isn't days, the day-converted result too.

import type { TaskSchedule } from "./schedule";
import type { Estimate, EstimateUnit } from "./types";

const UNIT_TO_DAYS: Record<EstimateUnit, number> = {
	hour: 1 / 24,
	day: 1,
	week: 7,
};

const UNIT_NOUN: Record<EstimateUnit, string> = {
	hour: "hours",
	day: "days",
	week: "weeks",
};

// One-decimal, trailing-zero-trimmed; snaps ~0 to 0 and ∞ to a glyph.
export function fmtDays(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	const snapped = Math.abs(n) < 1e-6 ? 0 : n;
	if (Number.isInteger(snapped)) return snapped.toString();
	return snapped.toFixed(1);
}

// "(2 + 4·5 + 8) / 6 = 5" — the PERT weighted-mean arithmetic in the estimate's
// own unit (no unit suffix; callers add it). Returns null when there's no
// estimate to explain.
function expectedFormula(estimate: Estimate): string {
	const { optimistic: o, mostLikely: m, pessimistic: p } = estimate;
	const mean = (o + 4 * m + p) / 6;
	return `(${fmtDays(o)} + 4·${fmtDays(m)} + ${fmtDays(p)}) / 6 = ${fmtDays(mean)}`;
}

// The headline duration explainer: always the Beta-PERT expected value, with
// the worked formula, plus a note when the SCHEDULE uses a different effective
// duration (in-progress burn-down or team-capacity scaling) so the canvas/list
// number and the schedule stay reconcilable.
export function explainExpectedDuration(
	estimate: Estimate | undefined,
	sched?: Pick<TaskSchedule, "expected" | "duration" | "status" | "progress">,
): string {
	if (!estimate) {
		return "No estimate yet — add optimistic / most-likely / pessimistic values to compute a duration.";
	}
	const unit = estimate.unit;
	const noun = UNIT_NOUN[unit];
	let base = `Expected duration — the Beta-PERT weighted mean of your three-point estimate: ${expectedFormula(
		estimate,
	)} ${noun}`;
	if (unit !== "day") {
		const days =
			((estimate.optimistic + 4 * estimate.mostLikely + estimate.pessimistic) /
				6) *
			UNIT_TO_DAYS[unit];
		base += ` = ${fmtDays(days)} d`;
	}
	base += ". The most-likely value is weighted 4× the extremes.";

	if (!sched) return base;
	// When the effective scheduling duration diverges from the expected value,
	// say why — this is exactly the "weirdly calculated" gap users hit.
	const expected = sched.expected;
	const effective = sched.duration;
	if (Math.abs(effective - expected) > 1e-6) {
		if (sched.status === "completed") {
			base += ` This task is complete, so it adds 0 d to the schedule.`;
		} else if (sched.status === "in_progress") {
			base += ` It's ${sched.progress}% done, so only ${fmtDays(
				effective,
			)} d of remaining work feeds the schedule.`;
		} else {
			base += ` Team-capacity scaling stretches it to ${fmtDays(
				effective,
			)} d in the schedule.`;
		}
	}
	return base;
}

export function explainSlack(
	sched: Pick<
		TaskSchedule,
		"slack" | "critical" | "latestStart" | "earliestStart"
	>,
): string {
	if (sched.critical) {
		return "On the critical path: zero slack (latest start = earliest start), so any slip here moves the whole project finish.";
	}
	return `Slack = latest start − earliest start = ${fmtDays(
		sched.latestStart,
	)} − ${fmtDays(sched.earliestStart)} = ${fmtDays(
		sched.slack,
	)} d. The task can slip this much before it delays the project finish.`;
}

export function explainEarliestStart(
	sched: Pick<TaskSchedule, "earliestStart">,
): string {
	return `Earliest start (CPM ES) = day ${fmtDays(
		sched.earliestStart,
	)} — the soonest this task can begin once every predecessor (and its lag) is satisfied.`;
}

export function explainEarliestFinish(
	sched: Pick<TaskSchedule, "earliestStart" | "earliestFinish" | "duration">,
): string {
	return `Earliest finish (CPM EF) = earliest start + duration = ${fmtDays(
		sched.earliestStart,
	)} + ${fmtDays(sched.duration)} = day ${fmtDays(sched.earliestFinish)}.`;
}

export function explainLatestStart(
	sched: Pick<TaskSchedule, "latestStart" | "latestFinish" | "duration">,
): string {
	return `Latest start (CPM LS) = latest finish − duration = ${fmtDays(
		sched.latestFinish,
	)} − ${fmtDays(sched.duration)} = day ${fmtDays(
		sched.latestStart,
	)} — the last day it can start without delaying the project.`;
}

export function explainLatestFinish(
	sched: Pick<TaskSchedule, "latestFinish">,
): string {
	return `Latest finish (CPM LF) = day ${fmtDays(
		sched.latestFinish,
	)} — the last day it can end without pushing the project finish.`;
}

// Criticality from Monte Carlo: share of simulated runs the task landed on the
// critical path.
export function explainCriticality(criticality: number, trials = 1500): string {
	const pct = Math.round(criticality * 100);
	return `On the critical path in ${pct}% of ${trials.toLocaleString()} simulated runs. High values (≥80%) mean it drives the finish date in almost every plausible scenario — protect its estimate.`;
}

// ±95% confidence band around a summed expected duration, from variances added
// in quadrature (independent-task assumption).
export function explainConfidenceBand(band: number, taskCount: number): string {
	return `±${fmtDays(
		band,
	)} d is the 95% confidence band: ±1.96·√(Σσ²) over ${taskCount} task${
		taskCount === 1 ? "" : "s"
	}, each task's σ = (pessimistic − optimistic) / 6, summed in quadrature.`;
}

export const explainProjectDuration =
	"Project duration = the longest dependency chain (critical path) through the graph — the earliest everything can finish.";

export const explainProjectP50 =
	"P50 finish — the coin-flip date: across the simulated runs, half finished by here and half later.";

export const explainProjectP90 =
	"P90 finish — the safe-commit date: 9 in 10 simulated runs finished by here.";

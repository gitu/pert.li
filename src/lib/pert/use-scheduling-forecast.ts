import { useEffect, useMemo, useState } from "react";
import type { MonteCarloResult } from "./montecarlo";
import { DEFAULT_TRIALS } from "./montecarlo";
import { resolveScheduling } from "./resolve-scheduling";
import type { PertDoc } from "./types";
import { useMonteCarlo } from "./use-monte-carlo";

// Scheduling forecast for the Overview's Calendar & scheduling section.
//
// Wraps the (fast, worker-backed) Monte Carlo runner with a deliberately
// visible "calculating" state. The real simulation finishes in well under a
// second, but a finish-date forecast reads as a heavy, considered computation —
// so we gate the reveal behind a 1–2s timer and surface a spinner while it
// runs. The forecast re-runs automatically whenever the doc changes.
//
// The output is read-only — it is never written back to the Automerge doc.

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 2000;

// Trials drive the "Running N trials…" copy in the UI; keep them in step.
export const FORECAST_TRIALS = DEFAULT_TRIALS;

export type SchedulingForecast = {
	// The settled simulation result. Null once the gates have passed but the
	// simulation couldn't produce one (e.g. a dependency cycle) — callers should
	// treat `result == null && !calculating && !empty` as "forecast unavailable".
	result: MonteCarloResult | null;
	// True while either gate is still open: the artificial 1–2s window, or the
	// underlying simulation still running.
	calculating: boolean;
	// True when the doc has no estimable leaf tasks — nothing to forecast, so we
	// render guidance instead of a spinner.
	empty: boolean;
};

export function useSchedulingForecast(
	doc: PertDoc | null | undefined,
	options: { trials?: number; seed?: number } = {},
): SchedulingForecast {
	// Cheap "is there anything to simulate?" check, mirroring the leaf-task /
	// estimate predicate the calendar form uses for its total-work readout.
	const hasWork = useMemo(() => {
		if (!doc) return false;
		return Object.values(doc.tasksById).some(
			(t) => t.kind === "task" && Boolean(t.estimate),
		);
	}, [doc]);

	const trials = options.trials ?? FORECAST_TRIALS;
	const seed = options.seed;

	// PARALLEL-STAFFING: drive the simulation's staffed pass from the project's
	// stored config so the forecast card's "with parallel staffing" row reflects
	// what the user set. resolveScheduling clamps + applies the team-mode
	// exclusivity defaults; the simulator additionally ignores staffing when the
	// doc is on team capacity.
	const staffing = useMemo(
		() => (doc ? resolveScheduling(doc).staffing : undefined),
		[doc],
	);

	// Seeded so successive runs of an unchanged doc reveal the same numbers — the
	// fake delay shouldn't make the forecast jitter. `running` lets us wait for
	// the *current* run to finish: useMonteCarlo keeps the previous result in
	// place while a new run is in flight, so revealing on the timer alone could
	// publish stale numbers (or spin forever when a run resolves to null).
	const { result: mcResult, running } = useMonteCarlo(hasWork ? doc : null, {
		trials,
		seed,
		staffing,
	});

	const [delayElapsed, setDelayElapsed] = useState(false);

	// Reset the artificial window the instant `doc` identity changes — during
	// render, not in an effect — so a fresh edit is treated as not-yet-settled
	// immediately and we never paint the previous forecast for the new doc.
	// (React's documented "adjust state when a prop changes" pattern.)
	const [armedForDoc, setArmedForDoc] = useState(doc);
	if (armedForDoc !== doc) {
		setArmedForDoc(doc);
		setDelayElapsed(false);
	}

	// Arm the 1–2s timer for the current doc.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `doc` identity is the re-forecast trigger (it changes on every Automerge edit), not a value read in the body. `hasWork` guards the empty case.
	useEffect(() => {
		if (!hasWork) return;
		const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
		const timer = setTimeout(() => setDelayElapsed(true), delay);
		return () => clearTimeout(timer);
	}, [doc, hasWork]);

	// Settled only once BOTH gates pass: the artificial window has elapsed AND
	// the underlying simulation has actually finished. `result` is derived
	// straight from that — never a held-over value — so while `calculating` is
	// true `result` is strictly null. A settled `mcResult` of null (a dependency
	// cycle) is a valid "unavailable" outcome, not a reason to keep spinning.
	const settled = hasWork && delayElapsed && !running;
	return {
		result: settled ? mcResult : null,
		calculating: hasWork && !settled,
		empty: !hasWork,
	};
}

import { describe, expect, it } from "vitest";
import {
	explainConfidenceBand,
	explainCriticality,
	explainEarliestFinish,
	explainExpectedDuration,
	explainSlack,
	fmtDays,
} from "../explain";
import type { TaskSchedule } from "../schedule";
import type { Estimate } from "../types";

const EST: Estimate = {
	optimistic: 2,
	mostLikely: 5,
	pessimistic: 8,
	unit: "day",
};

// Minimal TaskSchedule stub — only the fields the explainers read.
function sched(over: Partial<TaskSchedule> = {}): TaskSchedule {
	return {
		taskId: "t",
		duration: 5,
		expected: 5,
		variance: 1,
		earliestStart: 0,
		earliestFinish: 5,
		latestStart: 0,
		latestFinish: 5,
		slack: 0,
		critical: true,
		status: "not_started",
		progress: 0,
		earliestStartDate: "2026-01-01",
		earliestFinishDate: "2026-01-06",
		latestStartDate: "2026-01-01",
		latestFinishDate: "2026-01-06",
		...over,
	};
}

describe("fmtDays", () => {
	it("trims trailing zeros and snaps ~0 and ∞", () => {
		expect(fmtDays(5)).toBe("5");
		expect(fmtDays(5.25)).toBe("5.3");
		// Rounds to 1dp FIRST, so values that round to an integer don't leak a
		// trailing ".0" (floating-point noise).
		expect(fmtDays(5.04)).toBe("5");
		expect(fmtDays(4.999)).toBe("5");
		expect(fmtDays(1e-9)).toBe("0");
		expect(fmtDays(Number.POSITIVE_INFINITY)).toBe("∞");
	});
});

describe("explainExpectedDuration", () => {
	it("shows the worked PERT formula with the actual operands", () => {
		const text = explainExpectedDuration(EST);
		expect(text).toContain("(2 + 4·5 + 8) / 6 = 5");
		expect(text).toContain("days");
	});

	it("uses a singular unit noun when the expected value is ~1", () => {
		expect(
			explainExpectedDuration({
				optimistic: 1,
				mostLikely: 1,
				pessimistic: 1,
				unit: "day",
			}),
		).toContain("= 1 day.");
		// Plural for anything else.
		expect(explainExpectedDuration(EST)).toContain("= 5 days");
	});

	it("converts non-day units and shows the day result", () => {
		const text = explainExpectedDuration({
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 3,
			unit: "week",
		});
		expect(text).toContain("weeks");
		expect(text).toContain("= 14 d"); // 2 weeks * 7
	});

	it("notes in-progress burn-down when effective < expected", () => {
		const text = explainExpectedDuration(
			EST,
			sched({ status: "in_progress", progress: 40, expected: 5, duration: 3 }),
		);
		expect(text).toContain("40% done");
		expect(text).toContain("3 d");
	});

	it("uses neutral wording when a not-started task's effective duration differs", () => {
		// Could be the most-likely basis OR team scaling — the explainer isn't
		// told which, so it must not assert a specific cause.
		const text = explainExpectedDuration(
			EST,
			sched({ status: "not_started", expected: 5, duration: 10 }),
		);
		expect(text).toContain("10 d");
		expect(text).toMatch(/scheduling basis|team-capacity/i);
		expect(text).not.toContain("Team-capacity scaling stretches");
	});

	it("handles a missing estimate", () => {
		expect(explainExpectedDuration(undefined)).toMatch(/No estimate/i);
	});
});

describe("explainSlack", () => {
	it("explains critical (zero slack)", () => {
		expect(explainSlack(sched({ critical: true }))).toMatch(/critical path/i);
	});

	it("shows the LS − ES arithmetic when there is slack", () => {
		const text = explainSlack(
			sched({ critical: false, latestStart: 4, earliestStart: 1, slack: 3 }),
		);
		expect(text).toContain("4 − 1 = 3");
	});

	it("treats near-zero (rounds to 0 d) but non-critical slack as effectively none", () => {
		// slack 0.03 renders "0 d" while critical is false — guard against the
		// contradictory "can slip 0 d" wording.
		const text = explainSlack(
			sched({
				critical: false,
				slack: 0.03,
				latestStart: 5.03,
				earliestStart: 5,
			}),
		);
		expect(text).toMatch(/Effectively no slack/i);
		expect(text).not.toContain("can slip");
	});
});

describe("explainEarliestFinish", () => {
	it("shows ES + duration = EF", () => {
		const text = explainEarliestFinish(
			sched({ earliestStart: 2, duration: 5, earliestFinish: 7 }),
		);
		expect(text).toContain("2 + 5 = day 7");
	});
});

describe("explainCriticality / explainConfidenceBand", () => {
	it("renders a percentage and trial count", () => {
		expect(explainCriticality(0.8, 1500)).toContain("80%");
		expect(explainCriticality(0.8, 1500)).toContain("1,500");
	});

	it("renders the ±band and task count", () => {
		const text = explainConfidenceBand(2.5, 3);
		expect(text).toContain("±2.5 d");
		expect(text).toContain("3 tasks");
	});
});

import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

// Side-channel results sink. Vitest's JSON reporter only records per-test
// pass/fail, but we also want a NUMERIC score: the per-scenario pass ratio
// (objective — derived from tool calls + final doc state, no LLM judging) and,
// separately, the LLM-judge's 0–5 scores. Each scenario appends one JSONL line
// here; scripts/eval-summary.mjs aggregates it into an objective score that is
// independent of the judge, plus the judge scores as their own dimension.
//
// One shared append-only file across Vitest workers (truncated once in
// global-setup.ts before the run). Path overridable via EVAL_RUNS_FILE.

export const RUNS_FILE = process.env.EVAL_RUNS_FILE ?? "eval-report/runs.jsonl";

export type ScenarioRecord = {
	type: "scenario";
	scenario: string;
	// "objective": pass/fail came from deterministic checks (tool calls, doc
	// state, schema/refusal). "judge": pass/fail depended on the LLM judge.
	kind: "objective" | "judge";
	passes: number;
	repeats: number;
	ratio: number;
};

export type JudgeRecord = {
	type: "judge";
	scenario: string;
	score: number; // 0–5
};

function append(line: ScenarioRecord | JudgeRecord): void {
	mkdirSync(dirname(RUNS_FILE), { recursive: true });
	appendFileSync(RUNS_FILE, `${JSON.stringify(line)}\n`);
}

export function recordScenario(rec: Omit<ScenarioRecord, "type">): void {
	append({ type: "scenario", ...rec });
}

export function recordJudgeScore(scenario: string, score: number): void {
	append({ type: "judge", scenario, score });
}

/** Truncate the runs file at the start of a suite (called from global-setup). */
export function resetRunsFile(): void {
	try {
		rmSync(RUNS_FILE);
	} catch {
		// absent on first run — nothing to remove
	}
}

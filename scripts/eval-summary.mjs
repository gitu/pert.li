#!/usr/bin/env node
// Reads the Vitest JSON-reporter output from the eval suite
// (`eval-report/results.json`) and prints a GitHub-flavoured markdown summary
// to stdout. The evals workflow pipes this into $GITHUB_STEP_SUMMARY and reuses
// it as the sticky PR comment body, so a reviewer sees per-scenario pass/fail
// (and the failure reason — which includes the repeat() "passed N/M" line)
// without downloading anything.
//
// Vitest JSON shape we read:
//   { numTotalTests, numPassedTests, numFailedTests, numPendingTests,
//     testResults: [ { name, assertionResults: [
//       { ancestorTitles, title, status, duration, failureMessages } ] } ] }
//
// Usage: node scripts/eval-summary.mjs [path-to-results.json]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv } from "node:process";

const file = argv[2] ?? "eval-report/results.json";

let report;
try {
	report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
	// Missing report → the run almost certainly errored before writing it, or
	// every scenario skipped (no provider key). Say so but exit clean so the
	// step doesn't fail twice.
	process.stdout.write(
		`## AI prompt evals\n\nNo eval report at \`${file}\` (${err.message}). Either every scenario skipped (no provider key configured) or the run crashed before writing results.\n`,
	);
	process.exit(0);
}

const rows = [];
for (const suite of report.testResults ?? []) {
	const fileName = (suite.name ?? "").split("/").slice(-1)[0];
	for (const a of suite.assertionResults ?? []) {
		rows.push({
			file: fileName,
			title: [...(a.ancestorTitles ?? []), a.title].filter(Boolean).join(" › "),
			status: a.status, // passed | failed | skipped | pending
			duration: a.duration ?? 0,
			error: (a.failureMessages ?? []).join("\n").trim(),
		});
	}
}

const count = (s) => rows.filter((r) => r.status === s).length;
const passed = count("passed");
const failed = count("failed");
const skipped = rows.filter(
	(r) => r.status === "skipped" || r.status === "pending",
).length;

const fmtMs = (ms) =>
	ms >= 60_000
		? `${(ms / 60_000).toFixed(1)} min`
		: ms >= 1_000
			? `${(ms / 1_000).toFixed(1)}s`
			: `${ms}ms`;

const repeats = process.env.EVAL_REPEATS ?? "5";
const threshold = process.env.EVAL_THRESHOLD ?? "0.8";

const out = [];
out.push("## AI prompt evals");
out.push("");
if (rows.length === 0 || (skipped > 0 && passed === 0 && failed === 0)) {
	out.push(
		"All scenarios were **skipped** — no LLM provider key is configured in this environment. Set one (e.g. `GEMINI_API_KEY`) to run the evals.",
	);
	out.push("");
	process.stdout.write(`${out.join("\n")}\n`);
	process.exit(0);
}
out.push(
	`Each scenario runs **${repeats}×** and must pass **≥ ${threshold}** of runs.`,
);
out.push("");
out.push("| ✅ Passed | ❌ Failed | ⏭ Skipped |");
out.push("|---:|---:|---:|");
out.push(`| ${passed} | ${failed} | ${skipped} |`);
out.push("");

// ----- Numeric scores from the runs sink (report.ts) -----
// Objective score is judge-independent: it aggregates the deterministic
// scenarios' pass ratios (tool calls + final doc state + schema/refusal).
// Judge scores (0–5) are reported separately so the two never mix.
const runsFile = process.env.EVAL_RUNS_FILE ?? join(dirname(file), "runs.jsonl");
const scenarioRecs = [];
const judgeRecs = [];
try {
	for (const ln of readFileSync(runsFile, "utf8").split("\n").filter(Boolean)) {
		const rec = JSON.parse(ln);
		if (rec.type === "scenario") scenarioRecs.push(rec);
		else if (rec.type === "judge") judgeRecs.push(rec);
	}
} catch {
	// no runs sink (older run / not produced) — skip the scores section
}

if (scenarioRecs.length > 0) {
	const objective = scenarioRecs.filter((r) => r.kind === "objective");
	const objPasses = objective.reduce((a, r) => a + r.passes, 0);
	const objRuns = objective.reduce((a, r) => a + r.repeats, 0);
	const objPct = objRuns ? Math.round((objPasses / objRuns) * 100) : 0;

	out.push("### Scores");
	out.push("");
	out.push(
		`**Objective score (judge-independent): ${objPct}%** — ${objPasses}/${objRuns} runs across ${objective.length} deterministic scenarios.`,
	);
	if (judgeRecs.length > 0) {
		const avg =
			judgeRecs.reduce((a, r) => a + r.score, 0) / judgeRecs.length;
		out.push("");
		out.push(
			`**Judge score: ${avg.toFixed(1)} / 5** — mean over ${judgeRecs.length} judged run(s). _Set an independent judge via \`EVAL_JUDGE_*\` to avoid self-grading bias._`,
		);
	}
	out.push("");
	out.push("| Scenario | Kind | Pass ratio |");
	out.push("|---|---|---:|");
	for (const r of scenarioRecs) {
		out.push(
			`| ${r.scenario} | ${r.kind} | ${r.passes}/${r.repeats} (${Math.round(r.ratio * 100)}%) |`,
		);
	}
	out.push("");
}

out.push("| Scenario | Result | Time |");
out.push("|---|---|---:|");
const icon = (s) =>
	s === "passed" ? "✅" : s === "failed" ? "❌" : "⏭";
for (const r of rows) {
	out.push(`| ${r.title} | ${icon(r.status)} | ${fmtMs(r.duration)} |`);
}

const failures = rows.filter((r) => r.status === "failed");
if (failures.length > 0) {
	out.push("");
	out.push("### Failures");
	for (const f of failures) {
		out.push(`- **${f.title}** (\`${f.file}\`)`);
		const firstLines = f.error.split("\n").slice(0, 6).join("\n");
		if (firstLines) {
			out.push("");
			out.push("  ```");
			for (const line of firstLines.split("\n")) out.push(`  ${line}`);
			out.push("  ```");
		}
	}
}

out.push("");
process.stdout.write(`${out.join("\n")}\n`);

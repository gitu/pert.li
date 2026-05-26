#!/usr/bin/env node
// Reads a Playwright JSON-reporter output file (`results.json`) and prints
// a GitHub-flavoured markdown summary to stdout. Designed to be piped into
// $GITHUB_STEP_SUMMARY by the e2e CI step so the Actions run page shows
// per-suite totals + a failed-test breakdown without anyone having to
// download the HTML report.
//
// Layout of the JSON we care about (Playwright 1.x):
//   suites[].suites[].specs[].tests[].results[]
// Each `result` has: status ("passed"|"failed"|"timedOut"|"skipped"|...),
// duration (ms), retry, error.message, attachments, etc.
//
// Usage: node scripts/playwright-summary.mjs <path-to-results.json>

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const file = argv[2];
if (!file) {
	console.error("usage: playwright-summary.mjs <results.json>");
	exit(2);
}

let report;
try {
	report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
	console.error(`could not read ${file}:`, err.message);
	exit(0); // exit clean — missing report shouldn't fail the job
}

// Flatten the nested suites tree into one list of (project, spec, test, result)
// rows. Playwright JSON nests projects -> describe blocks -> spec files
// arbitrarily deep, so we recurse rather than guess.
const rows = [];
function walk(suite, projectName, breadcrumbs) {
	const here = suite.title ? [...breadcrumbs, suite.title] : breadcrumbs;
	for (const spec of suite.specs ?? []) {
		for (const test of spec.tests ?? []) {
			const project = test.projectName || projectName || "";
			for (const result of test.results ?? []) {
				rows.push({
					project,
					file: spec.file ?? "",
					title: [...here, spec.title].filter(Boolean).join(" › "),
					status: result.status,
					duration: result.duration ?? 0,
					retry: result.retry ?? 0,
					error: result.error?.message?.split("\n")[0] ?? "",
				});
			}
		}
	}
	for (const child of suite.suites ?? []) walk(child, projectName, here);
}
for (const top of report.suites ?? []) {
	walk(top, top.title, []);
}

const totals = { passed: 0, failed: 0, timedOut: 0, skipped: 0, flaky: 0 };
// "flaky" = at least one retry passed after an earlier attempt failed.
// We compute it per-(project, title) since each retry becomes a new row.
const byKey = new Map();
for (const r of rows) {
	const key = `${r.project}::${r.title}`;
	const arr = byKey.get(key) ?? [];
	arr.push(r);
	byKey.set(key, arr);
}
for (const arr of byKey.values()) {
	const last = arr[arr.length - 1];
	const anyFailedEarly = arr.slice(0, -1).some((r) => r.status !== "passed");
	if (last.status === "passed" && anyFailedEarly) totals.flaky += 1;
	else if (last.status === "passed") totals.passed += 1;
	else if (last.status === "failed") totals.failed += 1;
	else if (last.status === "timedOut") totals.timedOut += 1;
	else if (last.status === "skipped") totals.skipped += 1;
}

const totalRuns = rows.length;
const totalUnique = byKey.size;
const wall = report.stats?.duration ?? 0;
const fmtMs = (ms) =>
	ms >= 60_000
		? `${(ms / 60_000).toFixed(1)} min`
		: ms >= 1_000
			? `${(ms / 1_000).toFixed(1)}s`
			: `${ms}ms`;

// ----- Markdown output -----
const out = [];
out.push("## Playwright E2E");
out.push("");
out.push(
	`**${totalUnique} tests** · ${totalRuns} attempts · wall time ${fmtMs(wall)}`,
);
out.push("");
out.push("| ✅ Passed | ❌ Failed | ⏱ Timed out | ⚠️ Flaky | ⏭ Skipped |");
out.push("|---:|---:|---:|---:|---:|");
out.push(
	`| ${totals.passed} | ${totals.failed} | ${totals.timedOut} | ${totals.flaky} | ${totals.skipped} |`,
);

// Per-project breakdown
const byProject = new Map();
for (const r of rows) {
	const arr = byProject.get(r.project) ?? [];
	arr.push(r);
	byProject.set(r.project, arr);
}
if (byProject.size > 1) {
	out.push("");
	out.push("### By project");
	out.push("| Project | Tests | Total time |");
	out.push("|---|---:|---:|");
	for (const [project, arr] of [...byProject.entries()].sort()) {
		const time = arr.reduce((a, b) => a + b.duration, 0);
		out.push(`| ${project} | ${arr.length} | ${fmtMs(time)} |`);
	}
}

// Failed-test detail
const failures = [...byKey.values()]
	.filter((arr) => {
		const last = arr[arr.length - 1];
		return last.status === "failed" || last.status === "timedOut";
	})
	.map((arr) => arr[arr.length - 1]);
if (failures.length > 0) {
	out.push("");
	out.push("### Failures");
	for (const f of failures) {
		out.push(
			`- **${f.project}** · \`${f.file}\` › ${f.title} (${fmtMs(f.duration)}, retry ${f.retry})`,
		);
		if (f.error) out.push(`  - ${f.error}`);
	}
}

// Slowest passing tests — useful to spot creep
const slowest = rows
	.filter((r) => r.status === "passed")
	.sort((a, b) => b.duration - a.duration)
	.slice(0, 10);
if (slowest.length > 0) {
	out.push("");
	out.push("### Slowest 10 passing tests");
	out.push("| Time | Project | Test |");
	out.push("|---:|---|---|");
	for (const r of slowest) {
		out.push(`| ${fmtMs(r.duration)} | ${r.project} | ${r.title} |`);
	}
}

out.push("");
process.stdout.write(`${out.join("\n")}\n`);

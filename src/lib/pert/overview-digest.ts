// Builds a compact markdown digest of a project plan, suitable for POSTing to
// the AI-summary endpoint. Pure + token-bounded: the Automerge doc lives only
// on the client, so the client renders this digest and the server wraps it in
// a prompt — the server never reconstructs the doc. Bounded so a 5000-task
// plan can't blow the model's context (and the operator's bill).

import type { ProjectOverview } from "./overview";
import { expected, statusOf } from "./schedule";
import type { PertDoc, Task, TaskId } from "./types";

// Caps. The outline is the unbounded part of the doc, so cap item count, per-
// title length, and the final string. Exported so the server-side input
// validator and tests can assert the same ceiling.
export const MAX_OUTLINE_ITEMS = 150;
export const MAX_TITLE_CHARS = 120;
export const MAX_DIGEST_CHARS = 12_000;

export function buildProjectDigest(
	doc: PertDoc,
	overview: ProjectOverview,
): string {
	const lines: string[] = [];
	lines.push(`# ${clampTitle(doc.title) || "Untitled project"}`);
	lines.push("");

	lines.push("## Key figures");
	lines.push(`- Tasks: ${overview.taskCount}`);
	lines.push(`- Milestones: ${overview.milestoneCount}`);
	lines.push(`- Containers: ${overview.containerCount}`);
	lines.push(`- Dependencies: ${overview.dependencyCount}`);
	if (overview.schedule.ok) {
		lines.push(
			`- Estimated duration: ${formatDays(overview.schedule.durationDays)} working days`,
		);
		lines.push(
			`- Schedule: ${overview.schedule.startDate} → ${overview.schedule.finishDate}`,
		);
		lines.push(
			`- Tasks on the critical path: ${overview.schedule.criticalCount}`,
		);
	} else {
		lines.push(
			`- ⚠️ Dependency cycle detected (${overview.schedule.cycle.length} tasks); schedule cannot be computed`,
		);
	}
	lines.push(
		`- Progress: ${Math.round(overview.progressPct)}% (completed ${overview.status.completed}, in progress ${overview.status.inProgress}, not started ${overview.status.notStarted})`,
	);
	lines.push("");

	lines.push("## Task outline");
	const entries = flattenOutline(doc);
	for (const { task, depth } of entries.slice(0, MAX_OUTLINE_ITEMS)) {
		lines.push(outlineLine(task, depth));
	}
	if (entries.length > MAX_OUTLINE_ITEMS) {
		lines.push(
			`…and ${entries.length - MAX_OUTLINE_ITEMS} more tasks (outline truncated)`,
		);
	}

	const digest = lines.join("\n");
	return digest.length > MAX_DIGEST_CHARS
		? `${digest.slice(0, MAX_DIGEST_CHARS)}\n…(truncated)`
		: digest;
}

// Pre-order traversal (parents before children) with depth, so the outline
// reads as an indented tree. Top-level items are parentId == null.
function flattenOutline(doc: PertDoc): Array<{ task: Task; depth: number }> {
	const byParent = new Map<TaskId | null, Task[]>();
	for (const t of Object.values(doc.tasksById)) {
		const key = t.parentId ?? null;
		const arr = byParent.get(key);
		if (arr) arr.push(t);
		else byParent.set(key, [t]);
	}
	const out: Array<{ task: Task; depth: number }> = [];
	const seen = new Set<TaskId>();
	const walk = (parentId: TaskId | null, depth: number) => {
		for (const task of byParent.get(parentId) ?? []) {
			// Guard against a malformed parent cycle (shouldn't happen, but a
			// digest builder must never infinite-loop).
			if (seen.has(task.id)) continue;
			seen.add(task.id);
			out.push({ task, depth });
			walk(task.id, depth + 1);
		}
	};
	walk(null, 0);
	// Promote any task unreachable from the root — a dangling parentId (parent
	// missing) or a parentId cycle — to the top level, so the digest never
	// silently drops real scope. Mirrors the orphan handling in layout.ts.
	for (const task of Object.values(doc.tasksById)) {
		if (seen.has(task.id)) continue;
		seen.add(task.id);
		out.push({ task, depth: 0 });
		walk(task.id, 1);
	}
	return out;
}

function outlineLine(t: Task, depth: number): string {
	const indent = "  ".repeat(depth);
	const bits: string[] = [];
	if (t.kind === "milestone") bits.push("milestone");
	else if (t.kind === "container") bits.push("container");
	const exp = expected(t.estimate);
	if (t.kind === "task" && exp > 0) bits.push(`${formatDays(exp)}d`);
	const status = statusOf(t);
	if (status === "completed") bits.push("done");
	else if (status === "in_progress")
		bits.push(t.progress ? `in progress ${t.progress}%` : "in progress");
	const suffix = bits.length ? ` (${bits.join(", ")})` : "";
	const key = t.key ? `[${t.key}] ` : "";
	return `${indent}- ${key}${clampTitle(t.title)}${suffix}`;
}

function clampTitle(title: string): string {
	const t = title ?? "";
	return t.length > MAX_TITLE_CHARS ? `${t.slice(0, MAX_TITLE_CHARS)}…` : t;
}

function formatDays(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	if (n === 0) return "0";
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

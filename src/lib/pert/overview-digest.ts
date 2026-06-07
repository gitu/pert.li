// Builds a compact markdown digest of a project plan, suitable for POSTing to
// the AI-summary endpoint. Pure + token-bounded: the Automerge doc lives only
// on the client, so the client renders this digest and the server wraps it in
// a prompt — the server never reconstructs the doc. Bounded so a 5000-task
// plan can't blow the model's context (and the operator's bill).

import { getChildGroups, getTasksInGroup } from "./hierarchy";
import { computeNumbering, type NumberingResult } from "./numbering";
import type { ProjectOverview } from "./overview";
import { expected, statusOf } from "./schedule";
import type { GroupId, PertDoc, Task } from "./types";

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
	lines.push(`- Groups: ${overview.groupCount}`);
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
	const numbers = computeNumbering(doc);
	const entries = flattenOutline(doc);
	for (const entry of entries.slice(0, MAX_OUTLINE_ITEMS)) {
		lines.push(outlineLine(entry, numbers));
	}
	if (entries.length > MAX_OUTLINE_ITEMS) {
		lines.push(
			`…and ${entries.length - MAX_OUTLINE_ITEMS} more items (outline truncated)`,
		);
	}

	const digest = lines.join("\n");
	return digest.length > MAX_DIGEST_CHARS
		? `${digest.slice(0, MAX_DIGEST_CHARS)}\n…(truncated)`
		: digest;
}

type OutlineEntry =
	| { kind: "group"; id: GroupId; name: string; depth: number }
	| { kind: "task"; task: Task; depth: number };

// Pre-order traversal of the group tree (group header, then its member tasks,
// then nested groups), so the outline reads as an indented WBS tree. Ungrouped
// tasks are listed at the root so the digest never silently drops real scope.
function flattenOutline(doc: PertDoc): OutlineEntry[] {
	const out: OutlineEntry[] = [];
	const visited = new Set<GroupId>();
	const emitGroup = (group: { id: GroupId; name: string }, depth: number) => {
		visited.add(group.id);
		out.push({ kind: "group", id: group.id, name: group.name, depth });
		for (const task of getTasksInGroup(doc, group.id)) {
			out.push({ kind: "task", task, depth: depth + 1 });
		}
		walk(group.id, depth + 1);
	};
	function walk(parentGroupId: GroupId | null, depth: number): void {
		for (const group of getChildGroups(doc, parentGroupId)) {
			if (visited.has(group.id)) continue; // cycle guard
			emitGroup(group, depth);
		}
	}
	walk(null, 0);
	// Promote any group unreachable from the root (a parentGroupId cycle) so its
	// members aren't silently dropped. Sorted for a deterministic digest.
	const orphans = Object.values(doc.groupsById)
		.filter((g) => !visited.has(g.id))
		.sort(
			(a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
		);
	for (const group of orphans) {
		if (visited.has(group.id)) continue;
		emitGroup(group, 0);
	}
	// Tasks with no group (or a dangling groupId) are listed at the root.
	for (const task of Object.values(doc.tasksById)) {
		const gid = task.groupId ?? null;
		if (gid && doc.groupsById[gid]) continue;
		out.push({ kind: "task", task, depth: 0 });
	}
	return out;
}

function outlineLine(entry: OutlineEntry, numbers: NumberingResult): string {
	const indent = "  ".repeat(entry.depth);
	if (entry.kind === "group") {
		const number = numbers.groups[entry.id];
		const prefix = number ? `${number} ` : "";
		return `${indent}- **${prefix}${clampTitle(entry.name)}**`;
	}
	const t = entry.task;
	const bits: string[] = [];
	if (t.kind === "milestone") bits.push("milestone");
	const exp = expected(t.estimate);
	if (t.kind === "task" && exp > 0) bits.push(`${formatDays(exp)}d`);
	const status = statusOf(t);
	if (status === "completed") bits.push("done");
	else if (status === "in_progress")
		bits.push(t.progress ? `in progress ${t.progress}%` : "in progress");
	const suffix = bits.length ? ` (${bits.join(", ")})` : "";
	const number = numbers.tasks[t.id];
	const prefix = number ? `${number} ` : "";
	return `${indent}- ${prefix}${clampTitle(t.title)}${suffix}`;
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

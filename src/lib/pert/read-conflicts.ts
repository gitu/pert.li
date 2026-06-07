import * as Automerge from "@automerge/automerge";
import type { TaskConflicts, TaskFieldConflict } from "./conflicts";
import type { Estimate, GroupId, PertDoc, TaskId } from "./types";

// Surface concurrent writes Automerge has merged on a per-task basis. The
// `getConflicts` API returns a map keyed by op id from the *parent* object,
// asked for a specific prop. We probe the fields the user actually cares
// about: title, estimate, groupId, notes.
//
// Automerge's merge already picks a "winning" value deterministically. The
// conflicts map only has more than one entry when peers wrote concurrently
// to the same field. We treat anything > 1 as a conflict the user should
// know about.

const PROBED_FIELDS = ["title", "estimate", "groupId", "notes"] as const;

export function readTaskConflicts(
	doc: PertDoc,
	taskId: TaskId,
): TaskConflicts | null {
	const task = doc.tasksById[taskId];
	if (!task) return null;
	const fields: TaskFieldConflict[] = [];
	for (const field of PROBED_FIELDS) {
		let conflicts: ReturnType<typeof Automerge.getConflicts> | undefined;
		try {
			conflicts = Automerge.getConflicts(task, field);
		} catch {
			// Story/test fixtures pass plain PertDoc objects (not Automerge
			// proxies); getConflicts throws "must be the document root" on those.
			// Treat that as "no conflicts to report" rather than propagating.
			return null;
		}
		if (!conflicts) continue;
		const entries = Object.entries(conflicts);
		if (entries.length < 2) continue;
		fields.push(toFieldConflict(field, entries));
	}
	if (fields.length === 0) return null;
	return { taskId, fields };
}

function toFieldConflict(
	field: (typeof PROBED_FIELDS)[number],
	entries: Array<[string, unknown]>,
): TaskFieldConflict {
	const values = entries.map(([opId, value]) => ({ opId, value }));
	switch (field) {
		case "title":
			return {
				field,
				values: values.map((v) => ({
					opId: v.opId,
					value: typeof v.value === "string" ? v.value : "",
				})),
			};
		case "estimate":
			return {
				field,
				values: values.map((v) => ({
					opId: v.opId,
					value: v.value as Estimate | undefined,
				})),
			};
		case "groupId":
			return {
				field,
				values: values.map((v) => ({
					opId: v.opId,
					value: (v.value as GroupId | null | undefined) ?? null,
				})),
			};
		case "notes":
			return {
				field,
				values: values.map((v) => ({
					opId: v.opId,
					value:
						typeof v.value === "string"
							? v.value
							: ((v.value as string | null | undefined) ?? null),
				})),
			};
	}
}

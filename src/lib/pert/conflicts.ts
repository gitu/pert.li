import type { Estimate, GroupId, PertDoc, Task, TaskId } from "./types";

// Pure conflict types and resolution mutators. The Automerge-using
// `readTaskConflicts` reader lives in `read-conflicts.ts` so this module
// stays importable by stories and Storybook without dragging in wasm.

export type TaskFieldConflict =
	| {
			field: "title";
			values: Array<{ opId: string; value: string }>;
	  }
	| {
			field: "estimate";
			values: Array<{ opId: string; value: Estimate | undefined }>;
	  }
	| {
			field: "groupId";
			values: Array<{ opId: string; value: GroupId | null }>;
	  }
	| {
			field: "notes";
			values: Array<{ opId: string; value: string | null }>;
	  };

export type TaskConflicts = {
	taskId: TaskId;
	fields: TaskFieldConflict[];
};

// Apply one branch of a conflict by writing it back; concurrent peers will
// observe the resolved value as a fresh change.
export function resolveTaskFieldMutation<F extends TaskFieldConflict["field"]>(
	taskId: TaskId,
	field: F,
	value: Extract<TaskFieldConflict, { field: F }>["values"][number]["value"],
): (doc: PertDoc) => void {
	return (doc) => {
		const draft = doc.tasksById[taskId];
		if (!draft) return;
		applyField(draft, field, value);
	};
}

// Average estimates resolution — only meaningful for the estimate field.
// Used when two collaborators set different optimistic/likely/pessimistic
// tuples and the user picks "average".
export function averageEstimatesMutation(
	taskId: TaskId,
	values: Array<Estimate | undefined>,
): ((doc: PertDoc) => void) | null {
	const real = values.filter((v): v is Estimate => Boolean(v));
	if (real.length === 0) return null;
	const unit = real[0].unit;
	const avg = (
		key: keyof Pick<Estimate, "optimistic" | "mostLikely" | "pessimistic">,
	) => real.reduce((sum, e) => sum + e[key], 0) / real.length;
	const resolved: Estimate = {
		optimistic: round2(avg("optimistic")),
		mostLikely: round2(avg("mostLikely")),
		pessimistic: round2(avg("pessimistic")),
		unit,
	};
	return (doc) => {
		const draft = doc.tasksById[taskId];
		if (!draft) return;
		draft.estimate = resolved;
	};
}

function applyField(
	task: Task,
	field: TaskFieldConflict["field"],
	value: unknown,
): void {
	switch (field) {
		case "title":
			task.title = typeof value === "string" ? value : "";
			return;
		case "estimate":
			if (value) task.estimate = value as Estimate;
			else delete task.estimate;
			return;
		case "groupId":
			task.groupId = (value as GroupId | null | undefined) ?? null;
			return;
		case "notes":
			if (typeof value === "string" && value.length > 0) task.notes = value;
			else delete task.notes;
			return;
	}
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

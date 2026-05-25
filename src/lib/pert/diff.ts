import type {
	Dependency,
	DependencyId,
	Estimate,
	PertDoc,
	Task,
	TaskId,
} from "./types";

// Pure structural diff between two PertDoc snapshots. We compare the
// content-bearing fields the user cares about (title / kind / estimate /
// parentId / notes for tasks; the endpoints + type + lag for deps) and
// ignore layout positions (those drift constantly).

export type TaskFieldChange =
	| { field: "title"; before: string; after: string }
	| { field: "kind"; before: Task["kind"]; after: Task["kind"] }
	| { field: "parentId"; before: TaskId | null; after: TaskId | null }
	| {
			field: "estimate";
			before: Estimate | undefined;
			after: Estimate | undefined;
	  }
	| { field: "notes"; before: string | null; after: string | null };

export type TaskChange = {
	id: TaskId;
	kind: "added" | "removed" | "changed";
	before: Task | null;
	after: Task | null;
	fields: TaskFieldChange[];
};

export type DependencyChange = {
	id: DependencyId;
	kind: "added" | "removed" | "changed";
	before: Dependency | null;
	after: Dependency | null;
};

export type DocDiff = {
	tasks: TaskChange[];
	dependencies: DependencyChange[];
	// Aggregate counts for quick header rendering.
	counts: {
		tasksAdded: number;
		tasksRemoved: number;
		tasksChanged: number;
		depsAdded: number;
		depsRemoved: number;
		depsChanged: number;
	};
};

export function diffPertDoc(before: PertDoc, after: PertDoc): DocDiff {
	const tasks = diffTasks(before, after);
	const dependencies = diffDependencies(before, after);
	return {
		tasks,
		dependencies,
		counts: {
			tasksAdded: tasks.filter((t) => t.kind === "added").length,
			tasksRemoved: tasks.filter((t) => t.kind === "removed").length,
			tasksChanged: tasks.filter((t) => t.kind === "changed").length,
			depsAdded: dependencies.filter((d) => d.kind === "added").length,
			depsRemoved: dependencies.filter((d) => d.kind === "removed").length,
			depsChanged: dependencies.filter((d) => d.kind === "changed").length,
		},
	};
}

function diffTasks(before: PertDoc, after: PertDoc): TaskChange[] {
	const out: TaskChange[] = [];
	const beforeIds = Object.keys(before.tasksById);
	const afterIds = Object.keys(after.tasksById);
	const seen = new Set<string>();
	for (const id of beforeIds) {
		seen.add(id);
		const b = before.tasksById[id];
		const a = after.tasksById[id];
		if (!a) {
			out.push({ id, kind: "removed", before: b, after: null, fields: [] });
			continue;
		}
		const fields = compareTaskFields(b, a);
		if (fields.length > 0) {
			out.push({ id, kind: "changed", before: b, after: a, fields });
		}
	}
	for (const id of afterIds) {
		if (seen.has(id)) continue;
		const a = after.tasksById[id];
		out.push({ id, kind: "added", before: null, after: a, fields: [] });
	}
	// Stable order: added → changed → removed, alphabetical within each.
	const order = { added: 0, changed: 1, removed: 2 } as const;
	out.sort(
		(x, y) =>
			order[x.kind] - order[y.kind] ||
			titleOf(x).localeCompare(titleOf(y), undefined, { numeric: true }),
	);
	return out;
}

function compareTaskFields(b: Task, a: Task): TaskFieldChange[] {
	const out: TaskFieldChange[] = [];
	if (b.title !== a.title) {
		out.push({ field: "title", before: b.title, after: a.title });
	}
	if (b.kind !== a.kind) {
		out.push({ field: "kind", before: b.kind, after: a.kind });
	}
	const bp = b.parentId ?? null;
	const ap = a.parentId ?? null;
	if (bp !== ap) {
		out.push({ field: "parentId", before: bp, after: ap });
	}
	if (!estimateEqual(b.estimate, a.estimate)) {
		out.push({ field: "estimate", before: b.estimate, after: a.estimate });
	}
	const bn = b.notes ?? null;
	const an = a.notes ?? null;
	if (bn !== an) {
		out.push({ field: "notes", before: bn, after: an });
	}
	return out;
}

function diffDependencies(before: PertDoc, after: PertDoc): DependencyChange[] {
	const out: DependencyChange[] = [];
	const seen = new Set<string>();
	for (const [id, b] of Object.entries(before.dependenciesById)) {
		seen.add(id);
		const a = after.dependenciesById[id];
		if (!a) {
			out.push({ id, kind: "removed", before: b, after: null });
			continue;
		}
		if (!dependencyEqual(b, a)) {
			out.push({ id, kind: "changed", before: b, after: a });
		}
	}
	for (const [id, a] of Object.entries(after.dependenciesById)) {
		if (seen.has(id)) continue;
		out.push({ id, kind: "added", before: null, after: a });
	}
	const order = { added: 0, changed: 1, removed: 2 } as const;
	out.sort((x, y) => order[x.kind] - order[y.kind] || x.id.localeCompare(y.id));
	return out;
}

function estimateEqual(
	a: Estimate | undefined,
	b: Estimate | undefined,
): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return (
		a.optimistic === b.optimistic &&
		a.mostLikely === b.mostLikely &&
		a.pessimistic === b.pessimistic &&
		a.unit === b.unit
	);
}

function dependencyEqual(a: Dependency, b: Dependency): boolean {
	return (
		a.type === b.type &&
		(a.lagDays ?? 0) === (b.lagDays ?? 0) &&
		(a.from.taskId ?? null) === (b.from.taskId ?? null) &&
		(a.to.taskId ?? null) === (b.to.taskId ?? null) &&
		(a.from.interfaceId ?? null) === (b.from.interfaceId ?? null) &&
		(a.to.interfaceId ?? null) === (b.to.interfaceId ?? null)
	);
}

function titleOf(change: TaskChange): string {
	return (
		change.after?.title || change.before?.title || change.after?.id || change.id
	);
}

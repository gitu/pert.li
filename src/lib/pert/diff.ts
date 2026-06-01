import type {
	Dependency,
	DependencyId,
	Estimate,
	PertDoc,
	Task,
	TaskId,
	TaskStatus,
} from "./types";

// Pure structural diff between two PertDoc snapshots. We compare the
// content-bearing fields the user cares about (title / kind / parentId /
// key / estimate / notes / status / progress / actualStart / actualFinish
// for tasks; type + lagDays + endpoints for deps) and ignore layout
// positions (those drift constantly).

export type TaskFieldChange =
	| { field: "title"; before: string; after: string }
	| { field: "kind"; before: Task["kind"]; after: Task["kind"] }
	| { field: "parentId"; before: TaskId | null; after: TaskId | null }
	| { field: "key"; before: string | null; after: string | null }
	| {
			field: "estimate";
			before: Estimate | undefined;
			after: Estimate | undefined;
	  }
	| { field: "notes"; before: string | null; after: string | null }
	| {
			field: "status";
			before: TaskStatus | null;
			after: TaskStatus | null;
	  }
	| { field: "progress"; before: number | null; after: number | null }
	| { field: "actualStart"; before: string | null; after: string | null }
	| { field: "actualFinish"; before: string | null; after: string | null };

export type TaskChange = {
	id: TaskId;
	kind: "added" | "removed" | "changed";
	before: Task | null;
	after: Task | null;
	fields: TaskFieldChange[];
};

export type DependencyFieldChange =
	| {
			field: "type";
			before: Dependency["type"];
			after: Dependency["type"];
	  }
	| { field: "lagDays"; before: number; after: number }
	| {
			field: "fromTaskId";
			before: TaskId | null;
			after: TaskId | null;
	  }
	| { field: "toTaskId"; before: TaskId | null; after: TaskId | null }
	| {
			field: "fromInterfaceId";
			before: string | null;
			after: string | null;
	  }
	| { field: "toInterfaceId"; before: string | null; after: string | null };

export type DependencyChange = {
	id: DependencyId;
	kind: "added" | "removed" | "changed";
	before: Dependency | null;
	after: Dependency | null;
	fields: DependencyFieldChange[];
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
	const bk = b.key ?? null;
	const ak = a.key ?? null;
	if (bk !== ak) {
		out.push({ field: "key", before: bk, after: ak });
	}
	if (!estimateEqual(b.estimate, a.estimate)) {
		out.push({ field: "estimate", before: b.estimate, after: a.estimate });
	}
	const bn = b.notes ?? null;
	const an = a.notes ?? null;
	if (bn !== an) {
		out.push({ field: "notes", before: bn, after: an });
	}
	const bs = b.status ?? null;
	const as_ = a.status ?? null;
	if (bs !== as_) {
		out.push({ field: "status", before: bs, after: as_ });
	}
	const bpr = b.progress ?? null;
	const apr = a.progress ?? null;
	if (bpr !== apr) {
		out.push({ field: "progress", before: bpr, after: apr });
	}
	const bas = b.actualStart ?? null;
	const aas = a.actualStart ?? null;
	if (bas !== aas) {
		out.push({ field: "actualStart", before: bas, after: aas });
	}
	const baf = b.actualFinish ?? null;
	const aaf = a.actualFinish ?? null;
	if (baf !== aaf) {
		out.push({ field: "actualFinish", before: baf, after: aaf });
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
			out.push({ id, kind: "removed", before: b, after: null, fields: [] });
			continue;
		}
		const fields = compareDependencyFields(b, a);
		if (fields.length > 0) {
			out.push({ id, kind: "changed", before: b, after: a, fields });
		}
	}
	for (const [id, a] of Object.entries(after.dependenciesById)) {
		if (seen.has(id)) continue;
		out.push({ id, kind: "added", before: null, after: a, fields: [] });
	}
	const order = { added: 0, changed: 1, removed: 2 } as const;
	out.sort((x, y) => order[x.kind] - order[y.kind] || x.id.localeCompare(y.id));
	return out;
}

function compareDependencyFields(
	b: Dependency,
	a: Dependency,
): DependencyFieldChange[] {
	const out: DependencyFieldChange[] = [];
	if (b.type !== a.type) {
		out.push({ field: "type", before: b.type, after: a.type });
	}
	const bl = b.lagDays ?? 0;
	const al = a.lagDays ?? 0;
	if (bl !== al) {
		out.push({ field: "lagDays", before: bl, after: al });
	}
	const bf = b.from.taskId ?? null;
	const af = a.from.taskId ?? null;
	if (bf !== af) {
		out.push({ field: "fromTaskId", before: bf, after: af });
	}
	const bt = b.to.taskId ?? null;
	const at = a.to.taskId ?? null;
	if (bt !== at) {
		out.push({ field: "toTaskId", before: bt, after: at });
	}
	const bfi = b.from.interfaceId ?? null;
	const afi = a.from.interfaceId ?? null;
	if (bfi !== afi) {
		out.push({ field: "fromInterfaceId", before: bfi, after: afi });
	}
	const bti = b.to.interfaceId ?? null;
	const ati = a.to.interfaceId ?? null;
	if (bti !== ati) {
		out.push({ field: "toInterfaceId", before: bti, after: ati });
	}
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

function titleOf(change: TaskChange): string {
	return (
		change.after?.title || change.before?.title || change.after?.id || change.id
	);
}

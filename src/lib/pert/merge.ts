import {
	type DependencyChange,
	type DependencyFieldChange,
	type DocDiff,
	diffPertDoc,
	type TaskChange,
	type TaskFieldChange,
} from "./diff";
import type { Dependency, DependencyId, PertDoc, Task, TaskId } from "./types";

// 3-way merge between two PertDocs that share a common ancestor.
//
// We reuse the existing diff engine: compute `diffPertDoc(base, main)` and
// `diffPertDoc(base, branch)`, then join the two delta streams by
// (entityKind, id, field) and classify each delta. The interesting unit of
// work for the user is the FIELD: a field that both sides moved off-base in
// different ways is a conflict; everything else is either a clean take-from-
// branch, a no-op (only main moved, or both arrived at the same value), or a
// removal-vs-modification.
//
// The output is intentionally flat — one row per actionable change — so the
// UI can render it as a checkbox/3-way-picker list without re-walking the
// PertDoc.

export type MergeEntityKind = "task" | "dependency";

export type MergeClassification =
	// Branch changed a field, main didn't → safe to take from branch.
	| "clean-from-branch"
	// Branch added an entity (task or dep) that main doesn't have → safe to add.
	| "clean-add-from-branch"
	// Branch removed an entity that main hasn't touched → safe to remove.
	| "clean-remove-from-branch"
	// Both sides modified the same field to different values.
	| "conflict-modified"
	// Branch removed an entity main modified after the fork.
	| "conflict-removed-vs-modified"
	// Main removed an entity branch modified after the fork.
	| "conflict-modified-vs-removed"
	// Branch added the same entity id as main, but with different fields.
	| "conflict-add-vs-add";

export type MergeSide = "branch" | "main" | "skip";

export type FieldName = string;

// A single row in the merge UI. `field` is null when the row represents an
// entity-level operation (add or remove) that doesn't split per-field.
export type MergeChange =
	| {
			kind: "field";
			entity: MergeEntityKind;
			id: string;
			// Carry titles + the full before/after entity so the UI can render
			// rich context (e.g. show which task the field belongs to) without
			// re-walking the source docs.
			label: string;
			field: FieldName;
			base: unknown;
			main: unknown;
			branch: unknown;
			classification:
				| "clean-from-branch"
				| "conflict-modified"
				| "conflict-add-vs-add";
			suggestedSide: MergeSide;
	  }
	| {
			kind: "entity";
			entity: MergeEntityKind;
			id: string;
			label: string;
			classification:
				| "clean-add-from-branch"
				| "clean-remove-from-branch"
				| "conflict-removed-vs-modified"
				| "conflict-modified-vs-removed";
			// For add-from-branch: the new entity. For remove: null.
			branchEntity: Task | Dependency | null;
			// For modified-vs-removed: the surviving (main) entity we'd be asked
			// to delete. Null otherwise.
			mainEntity: Task | Dependency | null;
			suggestedSide: MergeSide;
	  };

export type MergeResult = {
	changes: MergeChange[];
	counts: {
		clean: number;
		conflict: number;
		// Number of branch-side moves that landed on the same value on main —
		// surfaced only as a summary, never as a row.
		sameResult: number;
	};
};

export function computeMerge(opts: {
	base: PertDoc;
	main: PertDoc;
	branch: PertDoc;
}): MergeResult {
	const baseVsMain = diffPertDoc(opts.base, opts.main);
	const baseVsBranch = diffPertDoc(opts.base, opts.branch);

	const changes: MergeChange[] = [];
	let sameResult = 0;

	// --- Tasks ---------------------------------------------------------------
	const mainTaskById = indexBy(baseVsMain.tasks, (t) => t.id);
	const branchTaskById = indexBy(baseVsBranch.tasks, (t) => t.id);
	const taskIds = new Set([
		...Object.keys(mainTaskById),
		...Object.keys(branchTaskById),
	]);
	for (const id of taskIds) {
		const m = mainTaskById[id];
		const b = branchTaskById[id];
		if (!b) continue; // Main-only change → not actionable from branch.

		// Branch added an entity.
		if (b.kind === "added") {
			if (!m || m.kind === "added") {
				// Both added the same id with potentially different fields.
				if (m?.kind === "added") {
					const fields = compareEntitiesAsFields(
						"task",
						b.after as Task,
						m.after as Task,
					);
					if (fields.length === 0) {
						sameResult += 1;
						continue;
					}
					const label = (m.after as Task).title;
					for (const f of fields) {
						changes.push({
							kind: "field",
							entity: "task",
							id,
							label,
							field: f.field,
							base: undefined,
							main: f.mainValue,
							branch: f.branchValue,
							classification: "conflict-add-vs-add",
							suggestedSide: "main",
						});
					}
					continue;
				}
				// Pure clean add — branch has it, main doesn't.
				changes.push({
					kind: "entity",
					entity: "task",
					id,
					label: (b.after as Task).title,
					classification: "clean-add-from-branch",
					branchEntity: b.after,
					mainEntity: null,
					suggestedSide: "branch",
				});
				continue;
			}
			// Should be unreachable — added in branch but mainBaseDiff says it
			// was modified, which implies it existed at base. Skip.
			continue;
		}

		if (b.kind === "removed") {
			if (m?.kind === "changed") {
				changes.push({
					kind: "entity",
					entity: "task",
					id,
					label: (m.before as Task).title,
					classification: "conflict-removed-vs-modified",
					branchEntity: null,
					mainEntity: m.after,
					suggestedSide: "main",
				});
				continue;
			}
			if (!m || m.kind === "removed") {
				// Removed only in branch (or by both) — main hasn't touched it.
				if (m?.kind === "removed") {
					sameResult += 1;
					continue;
				}
				changes.push({
					kind: "entity",
					entity: "task",
					id,
					label: (b.before as Task).title,
					classification: "clean-remove-from-branch",
					branchEntity: null,
					mainEntity: null,
					suggestedSide: "branch",
				});
			}
			continue;
		}

		// b.kind === "changed"
		if (m?.kind === "removed") {
			changes.push({
				kind: "entity",
				entity: "task",
				id,
				label: (b.before as Task).title,
				classification: "conflict-modified-vs-removed",
				branchEntity: b.after,
				mainEntity: null,
				suggestedSide: "main",
			});
			continue;
		}
		const label = (b.after as Task).title;
		for (const bf of b.fields) {
			const mf =
				m?.kind === "changed"
					? m.fields.find((x) => x.field === bf.field)
					: undefined;
			if (!mf) {
				changes.push({
					kind: "field",
					entity: "task",
					id,
					label,
					field: bf.field,
					base: bf.before,
					main: bf.before, // unchanged on main
					branch: bf.after,
					classification: "clean-from-branch",
					suggestedSide: "branch",
				});
				continue;
			}
			if (taskFieldValuesEqual(bf, mf)) {
				sameResult += 1;
				continue;
			}
			changes.push({
				kind: "field",
				entity: "task",
				id,
				label,
				field: bf.field,
				base: bf.before,
				main: mf.after,
				branch: bf.after,
				classification: "conflict-modified",
				suggestedSide: "main",
			});
		}
	}

	// --- Dependencies --------------------------------------------------------
	const mainDepById = indexBy(baseVsMain.dependencies, (d) => d.id);
	const branchDepById = indexBy(baseVsBranch.dependencies, (d) => d.id);
	const depIds = new Set([
		...Object.keys(mainDepById),
		...Object.keys(branchDepById),
	]);
	for (const id of depIds) {
		const m = mainDepById[id];
		const b = branchDepById[id];
		if (!b) continue;
		if (b.kind === "added") {
			if (!m || m.kind === "added") {
				if (m?.kind === "added") {
					const fields = compareEntitiesAsFields(
						"dependency",
						b.after as Dependency,
						m.after as Dependency,
					);
					if (fields.length === 0) {
						sameResult += 1;
						continue;
					}
					for (const f of fields) {
						changes.push({
							kind: "field",
							entity: "dependency",
							id,
							label: id,
							field: f.field,
							base: undefined,
							main: f.mainValue,
							branch: f.branchValue,
							classification: "conflict-add-vs-add",
							suggestedSide: "main",
						});
					}
					continue;
				}
				changes.push({
					kind: "entity",
					entity: "dependency",
					id,
					label: id,
					classification: "clean-add-from-branch",
					branchEntity: b.after,
					mainEntity: null,
					suggestedSide: "branch",
				});
				continue;
			}
			continue;
		}
		if (b.kind === "removed") {
			if (m?.kind === "changed") {
				changes.push({
					kind: "entity",
					entity: "dependency",
					id,
					label: id,
					classification: "conflict-removed-vs-modified",
					branchEntity: null,
					mainEntity: m.after,
					suggestedSide: "main",
				});
				continue;
			}
			if (!m || m.kind === "removed") {
				if (m?.kind === "removed") {
					sameResult += 1;
					continue;
				}
				changes.push({
					kind: "entity",
					entity: "dependency",
					id,
					label: id,
					classification: "clean-remove-from-branch",
					branchEntity: null,
					mainEntity: null,
					suggestedSide: "branch",
				});
			}
			continue;
		}
		if (m?.kind === "removed") {
			changes.push({
				kind: "entity",
				entity: "dependency",
				id,
				label: id,
				classification: "conflict-modified-vs-removed",
				branchEntity: b.after,
				mainEntity: null,
				suggestedSide: "main",
			});
			continue;
		}
		for (const bf of b.fields) {
			const mf =
				m?.kind === "changed"
					? m.fields.find((x) => x.field === bf.field)
					: undefined;
			if (!mf) {
				changes.push({
					kind: "field",
					entity: "dependency",
					id,
					label: id,
					field: bf.field,
					base: bf.before,
					main: bf.before,
					branch: bf.after,
					classification: "clean-from-branch",
					suggestedSide: "branch",
				});
				continue;
			}
			if (depFieldValuesEqual(bf, mf)) {
				sameResult += 1;
				continue;
			}
			changes.push({
				kind: "field",
				entity: "dependency",
				id,
				label: id,
				field: bf.field,
				base: bf.before,
				main: mf.after,
				branch: bf.after,
				classification: "conflict-modified",
				suggestedSide: "main",
			});
		}
	}

	// Stable sort: entity rows first within each (task → dep), then field rows
	// alphabetised by label. Keeps the merge UI deterministic across renders.
	changes.sort((a, b) => {
		const orderEntity =
			a.entity === b.entity ? 0 : a.entity === "task" ? -1 : 1;
		if (orderEntity !== 0) return orderEntity;
		const ka = a.kind === "entity" ? 0 : 1;
		const kb = b.kind === "entity" ? 0 : 1;
		if (ka !== kb) return ka - kb;
		return a.label.localeCompare(b.label, undefined, { numeric: true });
	});

	const conflict = changes.filter((c) =>
		c.classification.startsWith("conflict"),
	).length;
	const clean = changes.length - conflict;
	return { changes, counts: { clean, conflict, sameResult } };
}

function indexBy<T>(items: T[], key: (t: T) => string): Record<string, T> {
	const out: Record<string, T> = {};
	for (const it of items) out[key(it)] = it;
	return out;
}

function taskFieldValuesEqual(a: TaskFieldChange, b: TaskFieldChange): boolean {
	if (a.field !== b.field) return false;
	return jsonEqual(a.after, b.after);
}

function depFieldValuesEqual(
	a: DependencyFieldChange,
	b: DependencyFieldChange,
): boolean {
	if (a.field !== b.field) return false;
	return jsonEqual(a.after, b.after);
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

// When both sides added the same id, walk the on-disk shape and surface any
// per-field divergence. We don't need to use diffPertDoc here — the entities
// share their canonical shape, so a few direct comparisons are enough.
function compareEntitiesAsFields(
	kind: MergeEntityKind,
	branch: Task | Dependency,
	main: Task | Dependency,
): Array<{ field: FieldName; branchValue: unknown; mainValue: unknown }> {
	const out: Array<{
		field: FieldName;
		branchValue: unknown;
		mainValue: unknown;
	}> = [];
	if (kind === "task") {
		const b = branch as Task;
		const m = main as Task;
		for (const f of [
			"title",
			"kind",
			"parentId",
			"key",
			"estimate",
			"notes",
			"status",
			"progress",
			"actualStart",
			"actualFinish",
		] as const) {
			const bv = b[f];
			const mv = m[f];
			if (!jsonEqual(bv, mv))
				out.push({ field: f, branchValue: bv, mainValue: mv });
		}
	} else {
		const b = branch as Dependency;
		const m = main as Dependency;
		for (const f of ["type", "lagDays", "from", "to"] as const) {
			const bv = b[f];
			const mv = m[f];
			if (!jsonEqual(bv, mv))
				out.push({ field: f, branchValue: bv, mainValue: mv });
		}
	}
	return out;
}

// Re-exports used by callers building UI on top of a merge result. Keeps this
// module the single import for everything merge-related.
export type { DependencyChange, DependencyId, DocDiff, TaskChange, TaskId };

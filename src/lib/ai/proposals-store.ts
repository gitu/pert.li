import { Store } from "@tanstack/store";
import { type DocDiff, diffPertDoc } from "#/lib/pert/diff";
import type { ChangeFn } from "#/lib/pert/store";
import type { Dependency, PertDoc, Task } from "#/lib/pert/types";
import { applyOperations, type OpResult } from "./apply-operations";
import type { EditOp } from "./operations";

// Client-side staging area for AI-proposed changes.
//
// When the assistant calls `propose_changes`, we:
//   1. clone the current doc,
//   2. run the operations on the clone via applyOperations,
//   3. compute diffPertDoc(current, clone),
//   4. store the proposal under a generated id.
//
// The live doc is *not* touched until the user clicks Apply (all or per-row).
// On Apply all, we walk the operations again against the live doc — so any
// edits the user has made in the meantime collide normally (mutators surface
// "task not found" etc. through their existing error paths). On per-row
// Apply, we copy a single field/task/dep from the proposed doc onto the live
// doc using the field-level helpers below — that lets the user cherry-pick
// without re-running operations that may depend on each other.

export type Proposal = {
	id: string;
	createdAt: number;
	rationale: string;
	operations: EditOp[];
	proposedDoc: PertDoc;
	currentSnapshot: PertDoc;
	diff: DocDiff;
	results: OpResult[];
	// The project this proposal was staged against. Proposals must only ever
	// be applied to that project — applying one while a different project's
	// doc is active would import another project's tasks into it. null only
	// for legacy callers that don't know their project (Storybook mounts).
	projectId: string | null;
};

export type ProposalSummary = {
	tasksAffected: number;
	depsAffected: number;
	operationsApplied: number;
	operationsFailed: number;
	// One entry per operation that could not be staged, with the reason. Fed
	// back to the model through the propose_changes tool result so it can fix
	// the operations and re-propose instead of leaving the user with a
	// half-empty (or fully empty) preview.
	failures: Array<{ operationIndex: number; op: string; error: string }>;
};

type State = {
	byId: Record<string, Proposal>;
};

export const proposalsStore = new Store<State>({ byId: {} });

function nextId(): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `prop_${s}`;
}

// Deep-copy the live PertDoc into a plain-JS counterpart we can mutate freely
// without touching the Automerge doc. JSON round-trip works because PertDoc
// is JSON-serialisable by design (no functions, no class instances, no
// `undefined` that matter — Automerge already enforces those constraints).
function cloneDoc(doc: PertDoc): PertDoc {
	return JSON.parse(JSON.stringify(doc)) as PertDoc;
}

export function createProposal(
	currentDoc: PertDoc,
	rationale: string,
	operations: EditOp[],
	projectId: string | null = null,
): { proposal: Proposal; summary: ProposalSummary } {
	const proposedDoc = cloneDoc(currentDoc);
	const results = applyOperations(proposedDoc, operations);
	const currentSnapshot = cloneDoc(currentDoc);
	const diff = diffPertDoc(currentSnapshot, proposedDoc);
	const proposal: Proposal = {
		id: nextId(),
		createdAt: Date.now(),
		rationale,
		operations,
		proposedDoc,
		currentSnapshot,
		diff,
		results,
		projectId,
	};
	proposalsStore.setState((s) => ({
		byId: { ...s.byId, [proposal.id]: proposal },
	}));
	const summary: ProposalSummary = {
		tasksAffected:
			diff.counts.tasksAdded +
			diff.counts.tasksChanged +
			diff.counts.tasksRemoved,
		depsAffected:
			diff.counts.depsAdded + diff.counts.depsChanged + diff.counts.depsRemoved,
		operationsApplied: results.filter((r) => r.ok).length,
		operationsFailed: results.filter((r) => !r.ok).length,
		failures: results.flatMap((r) =>
			r.ok ? [] : [{ operationIndex: r.index, op: r.op, error: r.error }],
		),
	};
	return { proposal, summary };
}

// The propose_changes tool's entry point: stages a proposal, but refuses
// outright when NOT A SINGLE operation could be applied. Returning ok:true
// with an empty diff taught weaker models that probe operations "work" — they
// looped forever sending `set_title taskId:"nonexistent"` style placeholders,
// and every attempt left a dead "+0 ~0 −0" card in the chat. An explicit
// failure (with the reasons and the escape hatch spelled out) is both
// semantically honest and the strongest corrective signal a tool result can
// send.
export function stageProposal(
	currentDoc: PertDoc,
	rationale: string,
	operations: EditOp[],
	projectId: string | null = null,
):
	| { ok: true; proposal: Proposal; summary: ProposalSummary }
	| { ok: false; error: string } {
	const { proposal, summary } = createProposal(
		currentDoc,
		rationale,
		operations,
		projectId,
	);
	if (summary.operationsApplied === 0) {
		// Nothing staged — drop the empty proposal so it never renders a card.
		rejectProposal(proposal.id);
		const reasons = summary.failures
			.map((f) => `${f.op}: ${f.error}`)
			.join("; ");
		return {
			ok: false,
			error:
				`None of the ${operations.length} operation(s) could be staged: ${reasons}. ` +
				"Do NOT send probe or placeholder operations — every operation must reference real task ids " +
				"(from read_project or from ids you assign in this same batch) or create new tasks. " +
				"Top-level tasks take parentId: null; there is no task id for the project itself. " +
				"If you cannot produce the full import as one batch, call add_task directly for each item " +
				"(containers first, then children using the returned ids as parentId), then add_dependency for the edges.",
		};
	}
	return { ok: true, proposal, summary };
}

export function getProposal(id: string): Proposal | null {
	return proposalsStore.state.byId[id] ?? null;
}

export function rejectProposal(id: string): void {
	proposalsStore.setState((s) => {
		if (!s.byId[id]) return s;
		const { [id]: _, ...rest } = s.byId;
		return { byId: rest };
	});
}

// Apply every operation in the proposal against the live doc, in one
// Automerge change. After applying we evict the proposal — re-applying a
// stale proposal is a footgun (the operations no longer match the live
// state) so we'd rather force the user to re-prompt.
export function applyProposal(id: string, changeDoc: ChangeFn): OpResult[] {
	const proposal = getProposal(id);
	if (!proposal) return [];
	let results: OpResult[] = [];
	changeDoc((d) => {
		results = applyOperations(d, proposal.operations);
	});
	rejectProposal(id);
	return results;
}

// Apply a single field/task/dep from the proposal onto the live doc. The
// proposal stays in the store with the applied row removed from its diff so
// the UI can refresh without that line. If the proposal is empty afterwards,
// it's evicted.
export type ApplyRow =
	| { type: "task-field"; taskId: string; field: string }
	| { type: "task-added"; taskId: string }
	| { type: "task-removed"; taskId: string }
	| { type: "dependency"; depId: string };

export function applyProposalRow(
	id: string,
	row: ApplyRow,
	changeDoc: ChangeFn,
): void {
	const proposal = getProposal(id);
	if (!proposal) return;
	changeDoc((d) => applyRowMutation(d, proposal.proposedDoc, row));
	// Rebuild the proposal with a fresh diff against the now-updated current
	// snapshot. If nothing remains, evict.
	proposalsStore.setState((s) => {
		const existing = s.byId[id];
		if (!existing) return s;
		const refreshedSnapshot = cloneDoc(existing.currentSnapshot);
		applyRowMutation(refreshedSnapshot, existing.proposedDoc, row);
		const refreshedDiff = diffPertDoc(refreshedSnapshot, existing.proposedDoc);
		const empty =
			refreshedDiff.tasks.length === 0 &&
			refreshedDiff.dependencies.length === 0;
		if (empty) {
			const { [id]: _, ...rest } = s.byId;
			return { byId: rest };
		}
		return {
			byId: {
				...s.byId,
				[id]: {
					...existing,
					currentSnapshot: refreshedSnapshot,
					diff: refreshedDiff,
				},
			},
		};
	});
}

function applyRowMutation(
	target: PertDoc,
	source: PertDoc,
	row: ApplyRow,
): void {
	if (row.type === "task-added") {
		const t = source.tasksById[row.taskId];
		if (!t) return;
		if (target.tasksById[row.taskId]) return;
		// Copy the task plus any ancestor containers the live doc doesn't have
		// yet. Applying a child row before its parent-container row used to
		// leave the child's parentId dangling, which makes it invisible on the
		// nested canvas. Pulling the ancestors in keeps the hierarchy intact;
		// the rebuilt diff drops their rows automatically.
		copyTaskWithAncestors(target, source, row.taskId);
		return;
	}
	if (row.type === "task-removed") {
		const wasContainer = target.tasksById[row.taskId]?.kind === "container";
		delete target.tasksById[row.taskId];
		for (const [depId, dep] of Object.entries(target.dependenciesById)) {
			if (dep.from.taskId === row.taskId || dep.to.taskId === row.taskId) {
				delete target.dependenciesById[depId];
			}
		}
		for (const t of Object.values(target.tasksById)) {
			if (t.parentId === row.taskId) t.parentId = null;
		}
		// Drop any interface bucket the deleted task owned. Leaving it
		// behind would orphan interface definitions for a container that
		// no longer exists (or worse, attach them to a future task that
		// reuses the same id).
		if (wasContainer || target.interfacesByContainerId[row.taskId]) {
			delete target.interfacesByContainerId[row.taskId];
		}
		return;
	}
	if (row.type === "task-field") {
		const src = source.tasksById[row.taskId];
		const dst = target.tasksById[row.taskId];
		if (!src || !dst) return;
		copyTaskField(dst, src, row.field);
		return;
	}
	if (row.type === "dependency") {
		const src = source.dependenciesById[row.depId];
		if (!src) {
			delete target.dependenciesById[row.depId];
			return;
		}
		// Guard against partial-apply order: if the user applies a
		// dependency row before its prerequisite task-added rows, copying
		// the dep verbatim would point it at tasks that don't exist on
		// the live doc (or at a container endpoint, which addDependency
		// rejects). Drop the row silently — the diff will keep showing it
		// until the prerequisites land, then a second click applies it.
		if (
			!endpointValid(target, src.from.taskId) ||
			!endpointValid(target, src.to.taskId)
		) {
			return;
		}
		target.dependenciesById[row.depId] = JSON.parse(
			JSON.stringify(src),
		) as Dependency;
		return;
	}
}

// Copies a task from the proposed doc onto the live doc, walking parentId up
// and copying any ancestor (plus its interface bucket — containers without
// their Entry/Exit ports would render portless and break pinned deps) that the
// live doc is missing. Cycle-protected via the `seen` set.
function copyTaskWithAncestors(
	target: PertDoc,
	source: PertDoc,
	taskId: string,
): void {
	const seen = new Set<string>();
	let cursor: string | null = taskId;
	while (cursor && !seen.has(cursor)) {
		seen.add(cursor);
		const src: Task | undefined = source.tasksById[cursor];
		if (!src) break;
		if (!target.tasksById[cursor]) {
			target.tasksById[cursor] = JSON.parse(JSON.stringify(src)) as Task;
			if (src.kind === "container") {
				const sourceBucket = source.interfacesByContainerId[cursor];
				if (sourceBucket) {
					target.interfacesByContainerId[cursor] = JSON.parse(
						JSON.stringify(sourceBucket),
					);
				}
			}
		}
		cursor = src.parentId ?? null;
	}
}

function endpointValid(doc: PertDoc, taskId: string | undefined): boolean {
	if (!taskId) return false;
	const task = doc.tasksById[taskId];
	if (!task) return false;
	// Container endpoints aren't valid dep targets in this app's model —
	// addDependencyMutation rejects them. Mirror that here so user-applied
	// dep rows don't get into a state the rest of the app considers
	// invalid.
	return task.kind !== "container";
}

function copyTaskField(dst: Task, src: Task, field: string): void {
	switch (field) {
		case "title":
			dst.title = src.title;
			return;
		case "kind":
			dst.kind = src.kind;
			return;
		case "parentId":
			dst.parentId = src.parentId ?? null;
			return;
		case "key":
			if (src.key) dst.key = src.key;
			else delete dst.key;
			return;
		case "estimate":
			if (src.estimate) dst.estimate = JSON.parse(JSON.stringify(src.estimate));
			else delete dst.estimate;
			return;
		case "notes":
			if (src.notes) dst.notes = src.notes;
			else delete dst.notes;
			return;
		case "status":
			if (src.status) dst.status = src.status;
			else delete dst.status;
			return;
		case "progress":
			if (typeof src.progress === "number") dst.progress = src.progress;
			else delete dst.progress;
			return;
		case "actualStart":
			if (src.actualStart) dst.actualStart = src.actualStart;
			else delete dst.actualStart;
			return;
		case "actualFinish":
			if (src.actualFinish) dst.actualFinish = src.actualFinish;
			else delete dst.actualFinish;
			return;
	}
}

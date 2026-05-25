import type { Task } from "#/lib/pert/types";

// A task's `key` is a dotted, semantic identifier ("M1.A", "T.foo.bar") used
// purely for grouping in views — separate from parentId (which drives the
// scheduler) and from dependencies. Empty/missing keys are ungrouped.
//
// These helpers split keys into segments, group tasks into a tree, and let
// callers render nested rows / collapsible matrix sections without each view
// reimplementing the same string-splitting code.

export function parseKeySegments(key: string | undefined | null): string[] {
	if (!key) return [];
	return key
		.split(".")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

// Returns whether a key looks well-formed. Lenient on purpose — we don't
// want to block users from typing weird things; just used as a hint for
// inspector UX.
export function isReasonableKey(key: string): boolean {
	if (key.length === 0) return true;
	return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.?$/.test(key.trim());
}

export type KeyGroupNode<T> = {
	// Display label for this node. Either the leaf segment ("M1", "foo") or
	// "—" / empty when this is a synthetic root.
	label: string;
	// Full key prefix from the root to this node, joined with dots. Used as
	// a stable id for React keys, collapsed-state storage, etc.
	path: string;
	// Direct rows whose full key ends at this node (e.g. a task keyed "M1"
	// itself, distinct from tasks keyed "M1.A" / "M1.B" beneath it).
	rows: T[];
	children: KeyGroupNode<T>[];
};

// Group an arbitrary row list (tasks, list rows, matrix entries) by their
// `key`. Rows whose key is empty land under a synthetic "(ungrouped)" node
// at the top level. The tree preserves insertion order from the input.
//
// Simplification: if a node has no rows of its own and exactly one child,
// that child is hoisted into the parent's slot. So a key prefix that exists
// only as a single child collapses out — "T.only" becomes just "only" in
// the tree when nothing else is under "T".
export function groupTasksByKey<T extends { key?: string }>(
	rows: T[],
	{ ungroupedLabel = "(ungrouped)" }: { ungroupedLabel?: string } = {},
): KeyGroupNode<T>[] {
	const root: KeyGroupNode<T> = {
		label: "",
		path: "",
		rows: [],
		children: [],
	};
	const ungrouped: KeyGroupNode<T> = {
		label: ungroupedLabel,
		path: "__ungrouped__",
		rows: [],
		children: [],
	};

	for (const row of rows) {
		const segments = parseKeySegments(row.key);
		if (segments.length === 0) {
			ungrouped.rows.push(row);
			continue;
		}
		let cursor = root;
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const path = segments.slice(0, i + 1).join(".");
			let child = cursor.children.find((c) => c.label === seg);
			if (!child) {
				child = { label: seg, path, rows: [], children: [] };
				cursor.children.push(child);
			}
			if (i === segments.length - 1) child.rows.push(row);
			cursor = child;
		}
	}

	const result = root.children.map(simplify);
	if (ungrouped.rows.length > 0) result.push(ungrouped);
	return result;
}

// Recursive collapse of synthetic single-child intermediates with no own
// rows. We rewrite the node to keep the deeper label/path so the visible
// label matches what the user actually typed.
function simplify<T>(node: KeyGroupNode<T>): KeyGroupNode<T> {
	const children = node.children.map(simplify);
	if (node.rows.length === 0 && children.length === 1) {
		// Hoist the single child up; its path already includes the parent.
		return children[0];
	}
	return { ...node, children };
}

// Counts every row reachable from a group (own rows + descendants). Useful
// for "(3)" badges next to collapsed groups.
export function countRowsInGroup<T>(node: KeyGroupNode<T>): number {
	return (
		node.rows.length +
		node.children.reduce((sum, child) => sum + countRowsInGroup(child), 0)
	);
}

// Re-exported for downstream callers that just need the Task type to satisfy
// `T extends { key?: string }` while keeping the lib free of cycles.
export type KeyedTask = Pick<Task, "key">;

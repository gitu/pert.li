import { getChildGroups } from "./hierarchy";
import { computeNumbering, type NumberingResult } from "./numbering";
import type { GroupId, PertDoc } from "./types";

// Builds the nested view tree that the table / timeline / matrix render when
// "Group" is toggled on. Sourced from the first-class group collection (NOT a
// dotted string), so each node carries the group's name as its label and its
// derived WBS number. Rows are bucketed into their group by `row.groupId`.
//
// Groups whose entire subtree has no visible rows are pruned, so filtering/
// search in a view doesn't leave empty headers behind. Rows with no (or a
// dangling) group land under a synthetic "(ungrouped)" node.

export const UNGROUPED_PATH = "__ungrouped__";

export type KeyGroupNode<T> = {
	// The group this node represents, or null for the synthetic ungrouped node.
	groupId: GroupId | null;
	// Stable id for React keys / collapsed-state storage / testids: the group
	// id, or UNGROUPED_PATH.
	path: string;
	// Display label — the group's name, or the ungrouped label.
	label: string;
	// Derived WBS number ("1", "1.2"); "" for the ungrouped node.
	number: string;
	// Rows whose task belongs directly to this group.
	rows: T[];
	children: KeyGroupNode<T>[];
};

export function buildGroupTree<T extends { groupId?: GroupId | null }>(
	doc: PertDoc,
	rows: T[],
	{
		ungroupedLabel = "(ungrouped)",
		numbering,
	}: { ungroupedLabel?: string; numbering?: NumberingResult } = {},
): KeyGroupNode<T>[] {
	const numbers = numbering ?? computeNumbering(doc);

	const rowsByGroup = new Map<GroupId, T[]>();
	const ungrouped: T[] = [];
	for (const row of rows) {
		const gid = row.groupId ?? null;
		if (gid && doc.groupsById[gid]) {
			const bucket = rowsByGroup.get(gid);
			if (bucket) bucket.push(row);
			else rowsByGroup.set(gid, [row]);
		} else {
			ungrouped.push(row);
		}
	}

	function build(parentGroupId: GroupId | null): KeyGroupNode<T>[] {
		const out: KeyGroupNode<T>[] = [];
		for (const group of getChildGroups(doc, parentGroupId)) {
			const node: KeyGroupNode<T> = {
				groupId: group.id,
				path: group.id,
				label: group.name,
				number: numbers.groups[group.id] ?? "",
				rows: rowsByGroup.get(group.id) ?? [],
				children: build(group.id),
			};
			// Prune subtrees with no visible rows.
			if (node.rows.length > 0 || node.children.length > 0) out.push(node);
		}
		return out;
	}

	const result = build(null);
	if (ungrouped.length > 0) {
		result.push({
			groupId: null,
			path: UNGROUPED_PATH,
			label: ungroupedLabel,
			number: "",
			rows: ungrouped,
			children: [],
		});
	}
	return result;
}

// Counts every row reachable from a group (own rows + descendants). Useful for
// "(3)" badges next to collapsed groups.
export function countRowsInGroup<T>(node: KeyGroupNode<T>): number {
	return (
		node.rows.length +
		node.children.reduce((sum, child) => sum + countRowsInGroup(child), 0)
	);
}

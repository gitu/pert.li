import type { ProjectSummary } from "#/types/workspace";

// Builds the workspace's branch hierarchy as a recursive tree from a flat
// project list. A branch (`parentProjectId` set) nests under its parent when the
// parent is present in the list; otherwise it surfaces as a root and is flagged
// `isOrphanBranch` so the UI can still mark it as a branch ("parent
// unavailable") instead of dropping it. Handles branch-of-branch to arbitrary
// depth and guards against pathological parent cycles.

export type ProjectTreeNode = {
	project: ProjectSummary;
	children: ProjectTreeNode[];
	// True when this node carries a `parentProjectId` but that parent isn't in
	// the list (archived, different workspace, or simply absent). It renders at
	// root level yet still reads as a branch.
	isOrphanBranch: boolean;
};

// A branch nests under its parent only if following the parent chain doesn't
// loop back to itself. Returns false for self-references and cycles so a
// corrupt lineage can't make a node its own ancestor.
function reachesRootWithoutCycle(
	start: ProjectSummary,
	byId: Map<string, ProjectSummary>,
): boolean {
	const seen = new Set<string>([start.id]);
	let current: ProjectSummary | undefined = start;
	while (current?.parentProjectId) {
		const parent = byId.get(current.parentProjectId);
		if (!parent) return true; // chain leaves the list — fine, not a cycle
		if (seen.has(parent.id)) return false; // cycle
		seen.add(parent.id);
		current = parent;
	}
	return true;
}

export function buildProjectTree(
	projects: ProjectSummary[],
): ProjectTreeNode[] {
	const byId = new Map<string, ProjectSummary>();
	for (const p of projects) byId.set(p.id, p);

	const nodes = new Map<string, ProjectTreeNode>();
	for (const p of projects) {
		const hasParentInList = !!p.parentProjectId && byId.has(p.parentProjectId);
		nodes.set(p.id, {
			project: p,
			children: [],
			isOrphanBranch: !!p.parentProjectId && !hasParentInList,
		});
	}

	const roots: ProjectTreeNode[] = [];
	for (const p of projects) {
		const node = nodes.get(p.id);
		if (!node) continue;
		const parentInList =
			!!p.parentProjectId &&
			byId.has(p.parentProjectId) &&
			reachesRootWithoutCycle(p, byId);
		if (parentInList) {
			const parentNode = nodes.get(p.parentProjectId as string);
			if (parentNode) {
				parentNode.children.push(node);
				continue;
			}
		}
		// Root, orphan branch, or cycle member — surface at top level.
		roots.push(node);
	}

	// Sort branches deterministically — oldest fork first so the order doesn't
	// shuffle when a new branch lands. Roots keep the caller's input order.
	const sortChildren = (node: ProjectTreeNode) => {
		node.children.sort((a, b) => {
			const ba = a.project.branchedAt ?? a.project.createdAt;
			const bb = b.project.branchedAt ?? b.project.createdAt;
			return ba.localeCompare(bb);
		});
		for (const child of node.children) sortChildren(child);
	};
	for (const root of roots) sortChildren(root);

	return roots;
}

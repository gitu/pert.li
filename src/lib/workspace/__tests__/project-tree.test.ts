import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "#/types/workspace";
import { buildProjectTree, type ProjectTreeNode } from "../project-tree";

// Minimal ProjectSummary factory — only the fields buildProjectTree reads
// matter (id, parentProjectId, branchedAt, createdAt).
function p(
	id: string,
	opts: {
		parent?: string | null;
		createdAt?: string;
		branchedAt?: string | null;
	} = {},
): ProjectSummary {
	return {
		id,
		workspaceId: "ws",
		title: id,
		description: null,
		automergeDocUrl: `automerge:${id}` as ProjectSummary["automergeDocUrl"],
		createdAt: opts.createdAt ?? "2024-01-01T00:00:00.000Z",
		createdBy: "u",
		parentProjectId: opts.parent ?? null,
		branchedFromHeads: opts.parent ? ["h"] : null,
		branchedAt:
			opts.branchedAt ?? (opts.parent ? "2024-01-02T00:00:00.000Z" : null),
		archivedAt: null,
	};
}

function flatten(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
	return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function findNode(
	nodes: ProjectTreeNode[],
	id: string,
): ProjectTreeNode | undefined {
	return flatten(nodes).find((n) => n.project.id === id);
}

describe("buildProjectTree", () => {
	it("returns a flat list of roots when there are no branches", () => {
		const tree = buildProjectTree([p("a"), p("b"), p("c")]);
		expect(tree.map((n) => n.project.id)).toEqual(["a", "b", "c"]);
		expect(tree.every((n) => n.children.length === 0)).toBe(true);
	});

	it("nests a branch under its parent", () => {
		const tree = buildProjectTree([p("root"), p("branch", { parent: "root" })]);
		expect(tree).toHaveLength(1);
		expect(tree[0].project.id).toBe("root");
		expect(tree[0].children.map((n) => n.project.id)).toEqual(["branch"]);
	});

	it("nests recursively for a branch of a branch (A -> B -> C)", () => {
		const tree = buildProjectTree([
			p("A"),
			p("B", { parent: "A" }),
			p("C", { parent: "B" }),
		]);
		expect(tree).toHaveLength(1);
		const a = tree[0];
		expect(a.children.map((n) => n.project.id)).toEqual(["B"]);
		const b = a.children[0];
		expect(b.children.map((n) => n.project.id)).toEqual(["C"]);
		expect(b.children[0].children).toEqual([]);
	});

	it("surfaces an orphan branch (parent absent) at root level, flagged", () => {
		const tree = buildProjectTree([p("orphan", { parent: "gone" })]);
		expect(tree).toHaveLength(1);
		expect(tree[0].project.id).toBe("orphan");
		expect(tree[0].isOrphanBranch).toBe(true);
	});

	it("does not flag a normally-nested branch as orphan", () => {
		const tree = buildProjectTree([p("root"), p("b", { parent: "root" })]);
		expect(tree[0].isOrphanBranch).toBe(false);
		expect(tree[0].children[0].isOrphanBranch).toBe(false);
	});

	it("preserves input order of roots", () => {
		const tree = buildProjectTree([p("c"), p("a"), p("b")]);
		expect(tree.map((n) => n.project.id)).toEqual(["c", "a", "b"]);
	});

	it("sorts children by branchedAt ascending (oldest fork first)", () => {
		const tree = buildProjectTree([
			p("root"),
			p("late", { parent: "root", branchedAt: "2024-03-01T00:00:00.000Z" }),
			p("early", { parent: "root", branchedAt: "2024-02-01T00:00:00.000Z" }),
		]);
		expect(tree[0].children.map((n) => n.project.id)).toEqual([
			"early",
			"late",
		]);
	});

	it("does not hang or duplicate on a 2-cycle (a <-> b)", () => {
		const tree = buildProjectTree([
			p("a", { parent: "b" }),
			p("b", { parent: "a" }),
		]);
		// Both surface (at least one at root) and each appears exactly once.
		const all = flatten(tree)
			.map((n) => n.project.id)
			.sort();
		expect(all).toEqual(["a", "b"]);
	});

	// --- properties -----------------------------------------------------------

	// Build an arbitrary forest: each project may point at an earlier project as
	// its parent (so the "intended" structure is acyclic). The resulting list is
	// then shuffled (under fast-check's control) before building, so the builder
	// can't rely on parents preceding children in input order.
	const forest = fc
		.integer({ min: 0, max: 12 })
		.chain((n) =>
			fc.tuple(
				...Array.from({ length: n }, (_, i) =>
					i === 0
						? fc.constant<number | null>(null)
						: fc.option(fc.integer({ min: 0, max: i - 1 }), { nil: null }),
				),
			),
		)
		.map((parents) =>
			parents.map((parentIdx, i) =>
				p(`n${i}`, { parent: parentIdx == null ? null : `n${parentIdx}` }),
			),
		)
		.chain((projects) =>
			fc.shuffledSubarray(projects, {
				minLength: projects.length,
				maxLength: projects.length,
			}),
		);

	it("property: every input project appears exactly once in the tree", () => {
		fc.assert(
			fc.property(forest, (projects) => {
				const tree = buildProjectTree(projects);
				const ids = flatten(tree)
					.map((n) => n.project.id)
					.sort();
				const expected = projects.map((x) => x.id).sort();
				expect(ids).toEqual(expected);
			}),
		);
	});

	it("property: a node is never its own ancestor", () => {
		fc.assert(
			fc.property(forest, (projects) => {
				const tree = buildProjectTree(projects);
				const check = (node: ProjectTreeNode, ancestors: Set<string>) => {
					expect(ancestors.has(node.project.id)).toBe(false);
					const next = new Set(ancestors).add(node.project.id);
					for (const c of node.children) check(c, next);
				};
				for (const root of tree) check(root, new Set());
			}),
		);
	});

	it("property: a child's parentProjectId matches the node it nests under", () => {
		fc.assert(
			fc.property(forest, (projects) => {
				const tree = buildProjectTree(projects);
				const walk = (node: ProjectTreeNode) => {
					for (const c of node.children) {
						expect(c.project.parentProjectId).toBe(node.project.id);
						walk(c);
					}
				};
				for (const root of tree) walk(root);
			}),
		);
	});

	it("property: branches whose parent is present are reachable from that parent", () => {
		fc.assert(
			fc.property(forest, (projects) => {
				const ids = new Set(projects.map((x) => x.id));
				const tree = buildProjectTree(projects);
				for (const proj of projects) {
					if (proj.parentProjectId && ids.has(proj.parentProjectId)) {
						const parent = findNode(tree, proj.parentProjectId);
						// Either nested under its parent, or (only on a cycle) surfaced
						// at root — but cycles can't occur in this acyclic forest, so it
						// must be a child of its parent.
						expect(parent?.children.some((c) => c.project.id === proj.id)).toBe(
							true,
						);
					}
				}
			}),
		);
	});
});

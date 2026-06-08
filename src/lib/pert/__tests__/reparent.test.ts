import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	type Bounds,
	buildGroupSnapshot,
	findGroupAtPointInSnapshot,
	groupBoundsFromMembers,
	shiftGroupMembersMutation,
} from "#/lib/pert/reparent";
import {
	createEmptyPertDoc,
	type Group,
	type PertDoc,
	type Task,
} from "#/lib/pert/types";

const est = {
	optimistic: 1,
	mostLikely: 1,
	pessimistic: 1,
	unit: "day" as const,
};

function leaf(
	id: string,
	groupId: string | null = null,
	position: { x: number; y: number } | null = null,
): Task {
	return {
		id,
		kind: "task",
		title: id,
		groupId,
		estimate: est,
		layout: position ? { position } : undefined,
	};
}

function group(id: string, parentGroupId: string | null = null): Group {
	return { id, name: id, parentGroupId, order: 0 };
}

function build(groups: Group[], tasks: Task[]): PertDoc {
	const doc = createEmptyPertDoc("r");
	for (const g of groups) doc.groupsById[g.id] = g;
	for (const t of tasks) doc.tasksById[t.id] = t;
	return doc;
}

// True if `outer` fully encloses `inner` (used for the containment property).
function contains(outer: Bounds | null, inner: Bounds | null): boolean {
	if (!outer || !inner) return false;
	return (
		outer.x <= inner.x &&
		outer.y <= inner.y &&
		outer.x + outer.width >= inner.x + inner.width &&
		outer.y + outer.height >= inner.y + inner.height
	);
}

describe("groupBoundsFromMembers", () => {
	it("computes bounding box around member tasks (with padding)", () => {
		const doc = build(
			[group("box")],
			[leaf("A", "box", { x: 0, y: 0 }), leaf("B", "box", { x: 400, y: 200 })],
		);
		const b = groupBoundsFromMembers(doc, "box");
		expect(b).not.toBeNull();
		// minX = 0 - padX (36), minY = 0 - padTop (44).
		expect(b?.x).toBe(-36);
		expect(b?.y).toBe(-44);
		// width >= max(maxX - minX + 2*padX, MIN_WIDTH=440)
		// = max(400 + 200 + 72, 440) = 672.
		expect(b?.width).toBe(672);
	});

	it("returns minimum size when there are no positioned members", () => {
		const doc = build([group("box")], []);
		const b = groupBoundsFromMembers(doc, "box");
		expect(b).toEqual({ x: 0, y: 0, width: 440, height: 280 });
	});

	it("returns null for a missing group id", () => {
		const doc = build([], [leaf("A")]);
		expect(groupBoundsFromMembers(doc, "nope")).toBeNull();
	});

	it("wraps an expanded child group's box with its own padding", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[leaf("A", "inner", { x: 100, y: 100 })],
		);
		// inner wraps A with one pad; outer then wraps inner's box with another —
		// so a nested expanded group sits visibly *inside* its parent.
		const inner = groupBoundsFromMembers(doc, "inner");
		const outer = groupBoundsFromMembers(doc, "outer");
		expect(inner?.x).toBe(100 - 36);
		expect(inner?.y).toBe(100 - 44);
		expect(outer?.x).toBe((inner?.x ?? 0) - 36);
		expect(outer?.y).toBe((inner?.y ?? 0) - 44);
		// And the parent fully contains the child.
		expect(contains(outer, inner)).toBe(true);
	});

	it("REGRESSION: a collapsed child contributes only its card, not stale member positions", () => {
		// Inner's members sit far away (stale positions ELK never re-flowed after
		// collapse). With inner collapsed, outer must size to inner's small card
		// at its anchor — NOT balloon out to the ghost member positions.
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[
				leaf("near", "outer", { x: 0, y: 0 }),
				leaf("ghost1", "inner", { x: 5000, y: 5000 }),
				leaf("ghost2", "inner", { x: 5400, y: 5200 }),
			],
		);
		// Anchor the collapsed card near the rest of the graph (what onGroupToggle
		// stores at collapse time).
		doc.groupsById.inner.layout = { position: { x: 240, y: 0 } };

		const collapsed = new Set(["inner"]);
		const expanded = groupBoundsFromMembers(doc, "outer");
		const withCollapse = groupBoundsFromMembers(doc, "outer", { collapsed });

		// Expanded: ghost members blow the box out past x=5000.
		expect(expanded?.width ?? 0).toBeGreaterThan(5000);
		// Collapsed: the box stays tight around the near task + the 220×96 card.
		expect(withCollapse?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
		// The collapsed card (220×96 at x:240) is still inside outer.
		expect(withCollapse?.x).toBeLessThanOrEqual(240);
		expect(
			(withCollapse?.x ?? 0) + (withCollapse?.width ?? 0),
		).toBeGreaterThanOrEqual(240 + 220);
	});

	it("folds a child group beyond the depth cap into the parent's box", () => {
		const doc = build(
			[group("L1"), group("L2", "L1"), group("L3", "L2")],
			[leaf("a", "L2", { x: 0, y: 0 }), leaf("deep", "L3", { x: 600, y: 0 })],
		);
		// Cap at level 2: L3 renders no box, so its task `deep` folds into L2.
		const b = groupBoundsFromMembers(doc, "L2", { maxLevel: 2 });
		// `deep` at x=600 (+200 width) must be inside L2's box.
		expect((b?.x ?? 0) + (b?.width ?? 0)).toBeGreaterThanOrEqual(800);
	});
});

describe("buildGroupSnapshot + findGroupAtPointInSnapshot", () => {
	it("finds the deepest group whose bounds include the point", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "inner", { x: 300, y: 200 }),
			],
		);
		const snap = buildGroupSnapshot(doc, new Set());
		expect(findGroupAtPointInSnapshot(snap, { x: 200, y: 150 })).toBe("inner");
		expect(findGroupAtPointInSnapshot(snap, { x: -1000, y: -1000 })).toBe(null);
	});

	it("honors the collapsed set (skips collapsed groups)", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "inner", { x: 300, y: 200 }),
			],
		);
		const snap = buildGroupSnapshot(doc, new Set(["inner"]));
		expect(findGroupAtPointInSnapshot(snap, { x: 200, y: 150 })).toBe("outer");
	});

	it("honors excludeIds (drag-out: leaf removed from its group's bounds)", () => {
		// A single leaf inside its group: with the leaf excluded the group falls
		// back to MIN size around its own position (default 0,0). A far point
		// should miss the shrunk fallback box.
		const doc = build([group("box")], [leaf("A", "box", { x: 100, y: 100 })]);
		const snap = buildGroupSnapshot(doc, new Set(), new Set(["A"]));
		expect(findGroupAtPointInSnapshot(snap, { x: 1000, y: 1000 })).toBe(null);
	});

	it("sorts deepest-first so the linear scan returns the deepest hit", () => {
		const doc = build(
			[group("outer"), group("inner", "outer")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "inner", { x: 300, y: 200 }),
			],
		);
		const snap = buildGroupSnapshot(doc, new Set());
		expect(snap[0]?.id).toBe("inner");
		expect(snap[1]?.id).toBe("outer");
	});

	it("omits groups folded away by the depth cap (no box to drop into)", () => {
		const doc = build(
			[group("L1"), group("L2", "L1")],
			[leaf("A", "L2", { x: 100, y: 100 })],
		);
		// Cap at level 1: L2 renders no box, so it isn't a drop target.
		const snap = buildGroupSnapshot(doc, new Set(), undefined, 1);
		expect(snap.map((s) => s.id)).toEqual(["L1"]);
		// At the point of A, the hit resolves to L1 (A folded into it).
		expect(findGroupAtPointInSnapshot(snap, { x: 150, y: 130 })).toBe("L1");
	});
});

describe("groupBoundsFromMembers — containment property", () => {
	it("a rendered group's box always contains every rendered child box", () => {
		fc.assert(
			fc.property(
				// A small forest: up to 3 root groups, each with up to 2 children,
				// random collapse + a random depth cap.
				fc.record({
					rootCount: fc.integer({ min: 1, max: 3 }),
					childCounts: fc.array(fc.integer({ min: 0, max: 2 }), {
						minLength: 3,
						maxLength: 3,
					}),
					collapseInner: fc.boolean(),
					maxLevel: fc.constantFrom(1, 2, Number.POSITIVE_INFINITY),
				}),
				(cfg) => {
					const groups: Group[] = [];
					const tasks: Task[] = [];
					let tid = 0;
					for (let r = 0; r < cfg.rootCount; r++) {
						const rootId = `r${r}`;
						groups.push(group(rootId));
						tasks.push(leaf(`t${tid++}`, rootId, { x: r * 1000, y: 0 }));
						const kids = cfg.childCounts[r] ?? 0;
						for (let c = 0; c < kids; c++) {
							const childId = `r${r}c${c}`;
							groups.push(group(childId, rootId));
							tasks.push(
								leaf(`t${tid++}`, childId, {
									x: r * 1000 + c * 300 + 100,
									y: 400 + c * 200,
								}),
							);
						}
					}
					const doc = build(groups, tasks);
					const collapsed = new Set<string>(
						cfg.collapseInner
							? groups
									.filter((g) => g.parentGroupId != null)
									.map((g) => {
										// give collapsed groups an anchor position
										doc.groupsById[g.id].layout = {
											position: { x: 0, y: 0 },
										};
										return g.id;
									})
							: [],
					);
					const opts = { collapsed, maxLevel: cfg.maxLevel };

					for (const g of groups) {
						if (g.parentGroupId == null) continue; // child only
						const parent = g.parentGroupId;
						// Only meaningful when both render and the child is expanded.
						const childLevel = 2; // every child here is level 2
						if (childLevel > cfg.maxLevel) continue;
						if (collapsed.has(g.id)) continue;
						const childBox = groupBoundsFromMembers(doc, g.id, opts);
						const parentBox = groupBoundsFromMembers(doc, parent, opts);
						expect(contains(parentBox, childBox)).toBe(true);
					}
				},
			),
			{ numRuns: 200 },
		);
	});
});

describe("shiftGroupMembersMutation", () => {
	it("shifts every member task (including descendant groups) by (dx, dy)", () => {
		const doc = build(
			[group("box"), group("inner", "box")],
			[
				leaf("A", "inner", { x: 100, y: 100 }),
				leaf("B", "box", { x: 200, y: 50 }),
			],
		);
		shiftGroupMembersMutation("box", 30, -10)(doc);
		expect(doc.tasksById.A.layout?.position).toEqual({ x: 130, y: 90 });
		expect(doc.tasksById.B.layout?.position).toEqual({ x: 230, y: 40 });
	});

	it("leaves groups (which have no member position) untouched", () => {
		const doc = build(
			[group("box"), group("inner", "box")],
			[leaf("A", "inner", { x: 0, y: 0 })],
		);
		shiftGroupMembersMutation("box", 10, 10)(doc);
		expect(doc.groupsById.inner.layout).toBeUndefined();
		expect(doc.tasksById.A.layout?.position).toEqual({ x: 10, y: 10 });
	});
});

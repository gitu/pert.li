import { describe, expect, it } from "vitest";
import {
	buildGroupTree,
	countRowsInGroup,
	UNGROUPED_PATH,
} from "../group-tree";
import { createEmptyPertDoc, type Group, type PertDoc } from "../types";

function group(id: string, parentGroupId: string | null, order: number): Group {
	return { id, name: `Group ${id}`, parentGroupId, order };
}

function docWith(groups: Group[]): PertDoc {
	const doc = createEmptyPertDoc("test");
	for (const g of groups) doc.groupsById[g.id] = g;
	return doc;
}

type Row = { id: string; groupId?: string | null };

describe("buildGroupTree", () => {
	it("buckets rows under their group, sorted by group order", () => {
		const doc = docWith([group("b", null, 1), group("a", null, 0)]);
		const rows: Row[] = [
			{ id: "r1", groupId: "a" },
			{ id: "r2", groupId: "b" },
			{ id: "r3", groupId: "a" },
		];
		const tree = buildGroupTree(doc, rows);
		expect(tree.map((n) => n.path)).toEqual(["a", "b"]);
		expect(tree[0].label).toBe("Group a");
		expect(tree[0].number).toBe("1");
		expect(tree[0].rows.map((r) => r.id)).toEqual(["r1", "r3"]);
		expect(tree[1].rows.map((r) => r.id)).toEqual(["r2"]);
	});

	it("nests child groups and exposes their WBS number", () => {
		const doc = docWith([group("g1", null, 0), group("g1a", "g1", 0)]);
		const rows: Row[] = [
			{ id: "r1", groupId: "g1" },
			{ id: "r2", groupId: "g1a" },
		];
		const tree = buildGroupTree(doc, rows);
		expect(tree).toHaveLength(1);
		expect(tree[0].path).toBe("g1");
		expect(tree[0].children).toHaveLength(1);
		expect(tree[0].children[0].path).toBe("g1a");
		expect(tree[0].children[0].number).toBe("1.1");
		expect(tree[0].children[0].rows.map((r) => r.id)).toEqual(["r2"]);
	});

	it("puts ungrouped / dangling-group rows under a synthetic node", () => {
		const doc = docWith([group("g1", null, 0)]);
		const rows: Row[] = [
			{ id: "r1", groupId: "g1" },
			{ id: "r2" },
			{ id: "r3", groupId: "missing" },
		];
		const tree = buildGroupTree(doc, rows);
		const ungrouped = tree.find((n) => n.path === UNGROUPED_PATH);
		expect(ungrouped).toBeDefined();
		expect(ungrouped?.groupId).toBeNull();
		expect(ungrouped?.rows.map((r) => r.id).sort()).toEqual(["r2", "r3"]);
	});

	it("prunes group subtrees that have no visible rows", () => {
		const doc = docWith([group("empty", null, 0), group("full", null, 1)]);
		const tree = buildGroupTree(doc, [{ id: "r1", groupId: "full" }]);
		expect(tree.map((n) => n.path)).toEqual(["full"]);
	});

	it("keeps a parent group node when only a descendant has rows", () => {
		const doc = docWith([group("g1", null, 0), group("g1a", "g1", 0)]);
		const tree = buildGroupTree(doc, [{ id: "r1", groupId: "g1a" }]);
		expect(tree.map((n) => n.path)).toEqual(["g1"]);
		expect(tree[0].rows).toHaveLength(0);
		expect(tree[0].children.map((n) => n.path)).toEqual(["g1a"]);
	});
});

describe("countRowsInGroup", () => {
	it("counts own rows plus all descendant rows", () => {
		const doc = docWith([group("g1", null, 0), group("g1a", "g1", 0)]);
		const tree = buildGroupTree(doc, [
			{ id: "r1", groupId: "g1" },
			{ id: "r2", groupId: "g1a" },
			{ id: "r3", groupId: "g1a" },
		]);
		expect(countRowsInGroup(tree[0])).toBe(3);
	});
});

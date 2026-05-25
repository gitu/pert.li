import { describe, expect, it } from "vitest";
import {
	countRowsInGroup,
	groupTasksByKey,
	isReasonableKey,
	parseKeySegments,
} from "#/lib/pert/task-key";

type Row = { id: string; key?: string };

describe("parseKeySegments", () => {
	it("splits on dots, trims, drops empties", () => {
		expect(parseKeySegments("M1.A")).toEqual(["M1", "A"]);
		expect(parseKeySegments("T.foo.bar")).toEqual(["T", "foo", "bar"]);
		expect(parseKeySegments("  T .  foo  ")).toEqual(["T", "foo"]);
		expect(parseKeySegments("T.")).toEqual(["T"]);
		expect(parseKeySegments(".T")).toEqual(["T"]);
	});

	it("returns [] for empty / nullish inputs", () => {
		expect(parseKeySegments(undefined)).toEqual([]);
		expect(parseKeySegments(null)).toEqual([]);
		expect(parseKeySegments("")).toEqual([]);
		expect(parseKeySegments("   ")).toEqual([]);
	});
});

describe("isReasonableKey", () => {
	it("accepts the canonical shapes the UI suggests", () => {
		expect(isReasonableKey("")).toBe(true);
		expect(isReasonableKey("M1")).toBe(true);
		expect(isReasonableKey("M1.A")).toBe(true);
		expect(isReasonableKey("T.foo.bar")).toBe(true);
		expect(isReasonableKey("T.foo-1")).toBe(true);
		expect(isReasonableKey("T.foo_v2")).toBe(true);
		// Trailing dot tolerated — users type "M1." mid-edit.
		expect(isReasonableKey("M1.")).toBe(true);
	});

	it("flags clearly weird inputs", () => {
		expect(isReasonableKey("M 1")).toBe(false);
		expect(isReasonableKey("M/1")).toBe(false);
	});
});

describe("groupTasksByKey", () => {
	it("buckets tasks by their first segment", () => {
		const rows: Row[] = [
			{ id: "a", key: "M1" },
			{ id: "b", key: "M1.A" },
			{ id: "c", key: "M2" },
		];
		const tree = groupTasksByKey(rows);
		expect(tree.map((n) => n.label)).toEqual(["M1", "M2"]);
		const m1 = tree[0];
		expect(m1.rows.map((r) => r.id)).toEqual(["a"]);
		expect(m1.children.map((c) => c.label)).toEqual(["A"]);
		expect(m1.children[0].rows.map((r) => r.id)).toEqual(["b"]);
	});

	it("nests deeper paths", () => {
		const rows: Row[] = [
			{ id: "a", key: "T.foo" },
			{ id: "b", key: "T.foo.bar" },
			{ id: "c", key: "T.baz" },
		];
		const tree = groupTasksByKey(rows);
		expect(tree).toHaveLength(1);
		const t = tree[0];
		expect(t.label).toBe("T");
		expect(t.children.map((c) => c.label)).toEqual(["foo", "baz"]);
		expect(t.children[0].children[0].label).toBe("bar");
		expect(countRowsInGroup(t)).toBe(3);
	});

	it("simplifies a synthetic single-child intermediate with no own rows", () => {
		// Only one task under "T" — the empty "T" prefix collapses into its
		// child so the tree shows the leaf directly.
		const rows: Row[] = [{ id: "a", key: "T.only" }];
		const tree = groupTasksByKey(rows);
		expect(tree).toHaveLength(1);
		expect(tree[0].label).toBe("only");
		expect(tree[0].path).toBe("T.only");
	});

	it("does NOT simplify when the parent has its own row", () => {
		// "T" has a row of its own → must keep the "T" group as the header.
		const rows: Row[] = [
			{ id: "a", key: "T" },
			{ id: "b", key: "T.only" },
		];
		const tree = groupTasksByKey(rows);
		expect(tree).toHaveLength(1);
		expect(tree[0].label).toBe("T");
		expect(tree[0].rows.map((r) => r.id)).toEqual(["a"]);
		expect(tree[0].children[0].label).toBe("only");
	});

	it("collects keyless rows into an (ungrouped) bucket at the end", () => {
		const rows: Row[] = [
			{ id: "a", key: "M1" },
			{ id: "b" },
			{ id: "c", key: "" },
		];
		const tree = groupTasksByKey(rows, { ungroupedLabel: "—" });
		expect(tree.map((n) => n.label)).toEqual(["M1", "—"]);
		expect(tree[1].rows.map((r) => r.id)).toEqual(["b", "c"]);
	});

	it("omits the ungrouped bucket when everything has a key", () => {
		const rows: Row[] = [{ id: "a", key: "M1" }];
		const tree = groupTasksByKey(rows);
		expect(tree.map((n) => n.label)).toEqual(["M1"]);
	});

	it("preserves input order across siblings", () => {
		const rows: Row[] = [
			{ id: "c", key: "M1.C" },
			{ id: "a", key: "M1.A" },
			{ id: "b", key: "M1.B" },
		];
		const m1 = groupTasksByKey(rows)[0];
		expect(m1.children.map((c) => c.label)).toEqual(["C", "A", "B"]);
	});
});

describe("countRowsInGroup", () => {
	it("counts own rows + every descendant", () => {
		const rows: Row[] = [
			{ id: "a", key: "M1" },
			{ id: "b", key: "M1.A" },
			{ id: "c", key: "M1.B.x" },
		];
		const m1 = groupTasksByKey(rows)[0];
		expect(countRowsInGroup(m1)).toBe(3);
	});
});

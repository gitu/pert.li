import { describe, expect, it } from "vitest";
import {
	createDefaultInterface,
	ensureContainerInterfaces,
	getPrimaryInterface,
	newInterfaceId,
	removeContainerInterfaces,
} from "#/lib/pert/interfaces";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";

function seedWithContainer(id = "c1"): PertDoc {
	const d = createEmptyPertDoc("p");
	d.tasksById[id] = { id, kind: "container", title: "C", parentId: null };
	return d;
}

describe("newInterfaceId", () => {
	it("produces a unique-looking if_ prefix", () => {
		const a = newInterfaceId();
		const b = newInterfaceId();
		expect(a.startsWith("if_")).toBe(true);
		expect(a).not.toBe(b);
	});
});

describe("createDefaultInterface", () => {
	it("uses Entry/Exit labels by default", () => {
		const e = createDefaultInterface("c1", "entry", "if_e");
		const x = createDefaultInterface("c1", "exit", "if_x");
		expect(e).toEqual({
			id: "if_e",
			containerId: "c1",
			kind: "entry",
			label: "Entry",
		});
		expect(x.label).toBe("Exit");
	});
});

describe("ensureContainerInterfaces", () => {
	it("creates one entry and one exit for an empty container", () => {
		const d = seedWithContainer();
		ensureContainerInterfaces(d, "c1");
		const ifs = Object.values(d.interfacesByContainerId.c1 ?? {});
		expect(ifs).toHaveLength(2);
		expect(ifs.some((i) => i.kind === "entry")).toBe(true);
		expect(ifs.some((i) => i.kind === "exit")).toBe(true);
	});

	it("is idempotent — second call adds nothing", () => {
		const d = seedWithContainer();
		ensureContainerInterfaces(d, "c1");
		const before = Object.keys(d.interfacesByContainerId.c1 ?? {}).sort();
		ensureContainerInterfaces(d, "c1");
		const after = Object.keys(d.interfacesByContainerId.c1 ?? {}).sort();
		expect(after).toEqual(before);
	});

	it("only adds the missing kind when one exists", () => {
		const d = seedWithContainer();
		d.interfacesByContainerId.c1 = {
			if_custom: {
				id: "if_custom",
				containerId: "c1",
				kind: "entry",
				label: "Custom entry",
			},
		};
		ensureContainerInterfaces(d, "c1");
		const ifs = Object.values(d.interfacesByContainerId.c1);
		expect(ifs).toHaveLength(2);
		expect(ifs.find((i) => i.id === "if_custom")?.label).toBe("Custom entry");
		expect(ifs.some((i) => i.kind === "exit" && i.label === "Exit")).toBe(true);
	});
});

describe("removeContainerInterfaces", () => {
	it("drops the entire bucket", () => {
		const d = seedWithContainer();
		ensureContainerInterfaces(d, "c1");
		removeContainerInterfaces(d, "c1");
		expect(d.interfacesByContainerId.c1).toBeUndefined();
	});
});

describe("getPrimaryInterface", () => {
	it("returns null when no interface of that kind exists", () => {
		const d = seedWithContainer();
		expect(getPrimaryInterface(d, "c1", "entry")).toBeNull();
	});

	it("returns the unbound default when the user has added a bound one", () => {
		const d = seedWithContainer();
		d.interfacesByContainerId.c1 = {
			if_a: {
				id: "if_a",
				containerId: "c1",
				kind: "entry",
				label: "A",
				taskRef: "leaf_1",
			},
			if_b: {
				id: "if_b",
				containerId: "c1",
				kind: "entry",
				label: "B",
			},
		};
		const primary = getPrimaryInterface(d, "c1", "entry");
		expect(primary?.id).toBe("if_b");
	});

	it("falls back to lowest id when every interface is bound", () => {
		const d = seedWithContainer();
		d.interfacesByContainerId.c1 = {
			if_b: {
				id: "if_b",
				containerId: "c1",
				kind: "entry",
				label: "B",
				taskRef: "leaf_2",
			},
			if_a: {
				id: "if_a",
				containerId: "c1",
				kind: "entry",
				label: "A",
				taskRef: "leaf_1",
			},
		};
		expect(getPrimaryInterface(d, "c1", "entry")?.id).toBe("if_a");
	});
});

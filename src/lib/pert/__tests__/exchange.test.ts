import { describe, expect, it } from "vitest";
import {
	EXCHANGE_FORMAT_ID,
	EXCHANGE_SCHEMA_URL,
	EXCHANGE_SCHEMA_VERSION,
	fromExchange,
	parseExchange,
	serializeExchange,
	suggestExportFilename,
	summarizeExchange,
	toExchange,
} from "#/lib/pert/exchange";
import schemaJson from "#/lib/pert/exchange.schema.json";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";

function richDoc(): PertDoc {
	const d = createEmptyPertDoc("Q3 launch");
	d.groupsById = {
		g1: { id: "g1", name: "Phase 1", parentGroupId: null, order: 0 },
	};
	d.tasksById = {
		t1: {
			id: "t1",
			kind: "task",
			title: "Design",
			groupId: "g1",
			numberOverride: "P1.A",
			order: 0,
			estimate: { optimistic: 1, mostLikely: 3, pessimistic: 5, unit: "day" },
			notes: "watch out for handoff",
			status: "in_progress",
			progress: 40,
			actualStart: "2026-04-01",
			// Layout should be stripped on export.
			layout: { position: { x: 100, y: 50 } },
			metadata: {
				tags: ["design", "phase-1"],
				confidence: 0.8,
				// sourceRefs are internal — should NOT round-trip.
				sourceRefs: [{ documentId: "doc-1", page: 3 }],
			},
		},
		m1: {
			id: "m1",
			kind: "milestone",
			title: "Design review",
			groupId: "g1",
			order: 1,
		},
	};
	d.dependenciesById = {
		dep_a: {
			id: "dep_a",
			from: { taskId: "t1", port: "finish" },
			to: { taskId: "m1", port: "start" },
			type: "finish_to_start",
			lagDays: 2,
		},
	};
	d.calendar = {
		startDate: "2026-04-01",
		workingDays: [1, 2, 3, 4, 5],
		holidays: ["2026-05-01"],
		team: {
			peopleCount: 4,
			availabilityPct: 75,
			useHistoric: true,
			estimateBasis: "duration",
		},
		allocationMode: "team",
	};
	return d;
}

describe("toExchange", () => {
	it("emits the format discriminator and version", () => {
		const ex = toExchange(createEmptyPertDoc("p"), {
			exportedAt: "2026-05-25T00:00:00Z",
		});
		expect(ex.format).toBe(EXCHANGE_FORMAT_ID);
		expect(ex.schemaVersion).toBe(EXCHANGE_SCHEMA_VERSION);
		expect(ex.exportedAt).toBe("2026-05-25T00:00:00Z");
	});

	it("strips layout (positions)", () => {
		const ex = toExchange(richDoc());
		const t = ex.tasks.find((t) => t.id === "t1");
		expect(t).toBeDefined();
		expect((t as unknown as Record<string, unknown>).layout).toBeUndefined();
	});

	it("emits groups as a top-level array and references them via groupId", () => {
		const ex = toExchange(richDoc());
		expect(ex.groups).toEqual([
			{ id: "g1", name: "Phase 1", parentGroupId: null, order: 0 },
		]);
		const t1 = ex.tasks.find((t) => t.id === "t1");
		expect(t1?.groupId).toBe("g1");
		expect(t1?.numberOverride).toBe("P1.A");
		expect(t1?.order).toBe(0);
	});

	it("strips internal metadata.sourceRefs but preserves tags + confidence", () => {
		const ex = toExchange(richDoc());
		const t = ex.tasks.find((t) => t.id === "t1");
		expect(t?.tags).toEqual(["design", "phase-1"]);
		expect(t?.confidence).toBe(0.8);
		expect(
			(t as unknown as Record<string, unknown>).sourceRefs,
		).toBeUndefined();
		expect((t as unknown as Record<string, unknown>).metadata).toBeUndefined();
	});

	it("preserves status / progress / actual dates", () => {
		const ex = toExchange(richDoc());
		const t = ex.tasks.find((t) => t.id === "t1");
		expect(t?.status).toBe("in_progress");
		expect(t?.progress).toBe(40);
		expect(t?.actualStart).toBe("2026-04-01");
		expect(t?.actualFinish).toBeUndefined();
	});

	it("inlines deps on the successor task and drops the default type", () => {
		const ex = toExchange(richDoc());
		// dep_a goes from t1 → m1, so m1 (the successor) owns the dependsOn.
		const t1 = ex.tasks.find((t) => t.id === "t1");
		const m1 = ex.tasks.find((t) => t.id === "m1");
		expect(t1?.dependsOn).toBeUndefined();
		expect(m1?.dependsOn).toEqual([{ taskId: "t1" }]);
	});

	it("does not surface storage-internal dependency ids or lag", () => {
		// richDoc()'s dep_a carries lagDays: 2 — verify it's stripped on export.
		const ex = toExchange(richDoc());
		const m1 = ex.tasks.find((t) => t.id === "m1");
		expect(m1?.dependsOn?.[0]).not.toHaveProperty("id");
		expect(m1?.dependsOn?.[0]).not.toHaveProperty("lagDays");
	});

	it("keeps explicit non-default dep types", () => {
		const d = createEmptyPertDoc("p");
		d.tasksById = {
			a: { id: "a", kind: "task", title: "A" },
			b: { id: "b", kind: "task", title: "B" },
		};
		d.dependenciesById = {
			d1: {
				id: "d1",
				from: { taskId: "a", port: "start" },
				to: { taskId: "b", port: "start" },
				type: "start_to_start",
			},
		};
		const ex = toExchange(d);
		const b = ex.tasks.find((t) => t.id === "b");
		expect(b?.dependsOn?.[0].type).toBe("start_to_start");
	});

	it('drops a malformed dependency missing its `from` task (never emits taskId: "")', () => {
		const d = createEmptyPertDoc("p");
		d.tasksById = { b: { id: "b", kind: "task", title: "B" } };
		d.dependenciesById = {
			bad: {
				id: "bad",
				from: { port: "finish" }, // no taskId
				to: { taskId: "b", port: "start" },
				type: "finish_to_start",
			},
		};
		const ex = toExchange(d);
		// The dep is dropped rather than producing an invalid `taskId: ""` that
		// the exchange schema (taskId minLength 1) would reject.
		expect(ex.tasks.find((t) => t.id === "b")?.dependsOn).toBeUndefined();
		expect(parseExchange(serializeExchange(d)).ok).toBe(true);
	});

	it("omits empty groups/calendar and undefined estimate", () => {
		const empty = createEmptyPertDoc("p");
		const ex = toExchange(empty);
		expect(ex.calendar).toBeUndefined();
		expect(ex.groups).toBeUndefined();
		expect(ex.tasks).toEqual([]);
		// The format no longer has a top-level dependencies key at all.
		expect(
			(ex as unknown as Record<string, unknown>).dependencies,
		).toBeUndefined();
	});
});

describe("parseExchange", () => {
	it("accepts a JSON string", () => {
		const json = serializeExchange(richDoc(), {
			exportedAt: "2026-05-25T00:00:00Z",
		});
		const res = parseExchange(json);
		expect(res.ok).toBe(true);
	});

	it("accepts a parsed object", () => {
		const ex = toExchange(richDoc());
		const res = parseExchange(ex);
		expect(res.ok).toBe(true);
	});

	it("rejects garbage JSON with a useful message", () => {
		const res = parseExchange("not json {");
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error.toLowerCase()).toContain("json");
	});

	it("rejects the wrong format discriminator", () => {
		const res = parseExchange({
			format: "something-else",
			schemaVersion: 1,
			exportedAt: "x",
			title: "p",
			tasks: [],
		});
		expect(res.ok).toBe(false);
	});

	it("rejects unsupported schemaVersion", () => {
		const res = parseExchange({
			format: EXCHANGE_FORMAT_ID,
			schemaVersion: 999,
			exportedAt: "x",
			title: "p",
			tasks: [],
		});
		expect(res.ok).toBe(false);
	});

	it("rejects a task whose kind is no longer part of the model", () => {
		const res = parseExchange({
			format: EXCHANGE_FORMAT_ID,
			schemaVersion: 1,
			exportedAt: "x",
			title: "p",
			// "container" was removed from TaskKind in the groups refactor.
			tasks: [{ id: "t1", kind: "container", title: "T" }],
		});
		expect(res.ok).toBe(false);
	});

	it("rejects a dependsOn entry that omits taskId", () => {
		const res = parseExchange({
			format: EXCHANGE_FORMAT_ID,
			schemaVersion: 1,
			exportedAt: "x",
			title: "p",
			tasks: [
				{
					id: "t1",
					kind: "task",
					title: "T",
					dependsOn: [{ type: "finish_to_start" }],
				},
			],
		});
		expect(res.ok).toBe(false);
	});

	it("flags the offending path in validation errors", () => {
		const res = parseExchange({
			format: EXCHANGE_FORMAT_ID,
			schemaVersion: 1,
			exportedAt: "x",
			title: "p",
			tasks: [{ id: "t1", kind: "task", title: "T", progress: 200 }],
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain("tasks.0.progress");
	});
});

describe("round-trip", () => {
	it("a parsed export rebuilds a doc with the same content (minus stripped fields)", () => {
		const original = richDoc();
		const exchange = toExchange(original, {
			exportedAt: "2026-05-25T00:00:00Z",
		});
		const parsed = parseExchange(JSON.stringify(exchange));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const rebuilt = fromExchange(parsed.exchange);

		expect(rebuilt.title).toBe(original.title);
		// Groups round-trip verbatim.
		expect(rebuilt.groupsById.g1).toEqual(original.groupsById.g1);
		// Tasks: groupId + numberOverride preserved, layout dropped.
		for (const id of Object.keys(original.tasksById)) {
			const a = original.tasksById[id];
			const b = rebuilt.tasksById[id];
			expect(b).toBeDefined();
			expect(b.title).toBe(a.title);
			expect(b.kind).toBe(a.kind);
			expect(b.groupId ?? null).toBe(a.groupId ?? null);
			expect(b.numberOverride).toBe(a.numberOverride);
			expect(b.layout).toBeUndefined();
			if (a.metadata?.sourceRefs) {
				// sourceRefs deliberately not exported.
				expect(b.metadata?.sourceRefs).toBeUndefined();
			}
			if (a.metadata?.tags) {
				expect(b.metadata?.tags).toEqual(a.metadata.tags);
			}
		}
		// Dependencies are reconstructed with fresh storage ids and without
		// lag — see DependsOnEntry's comment. Edge type + endpoint identity
		// do round-trip though.
		const rebuiltDeps = Object.values(rebuilt.dependenciesById);
		expect(rebuiltDeps).toHaveLength(1);
		const rebuiltDep = rebuiltDeps[0];
		expect(rebuiltDep.id).toMatch(/^dep_/);
		expect(rebuiltDep.from).toEqual(original.dependenciesById.dep_a.from);
		expect(rebuiltDep.to).toEqual(original.dependenciesById.dep_a.to);
		expect(rebuiltDep.type).toBe(original.dependenciesById.dep_a.type);
		expect(rebuiltDep.lagDays).toBeUndefined();
		// Calendar preserved verbatim.
		expect(rebuilt.calendar).toEqual(original.calendar);
	});

	it("synthesizes a fresh dep id on every import", () => {
		const ex = parseExchange({
			format: EXCHANGE_FORMAT_ID,
			schemaVersion: 1,
			exportedAt: "x",
			title: "p",
			tasks: [
				{ id: "a", kind: "task", title: "A" },
				{
					id: "b",
					kind: "task",
					title: "B",
					dependsOn: [{ taskId: "a" }],
				},
			],
		});
		expect(ex.ok).toBe(true);
		if (!ex.ok) return;
		const doc = fromExchange(ex.exchange);
		const deps = Object.values(doc.dependenciesById);
		expect(deps).toHaveLength(1);
		expect(deps[0].from.taskId).toBe("a");
		expect(deps[0].to.taskId).toBe("b");
		expect(deps[0].id).toMatch(/^dep_/);
	});

	it("derives ports from the dep type on import", () => {
		const ex = parseExchange({
			format: EXCHANGE_FORMAT_ID,
			schemaVersion: 1,
			exportedAt: "x",
			title: "p",
			tasks: [
				{ id: "a", kind: "task", title: "A" },
				{
					id: "b",
					kind: "task",
					title: "B",
					dependsOn: [{ taskId: "a", type: "start_to_finish" }],
				},
			],
		});
		if (!ex.ok) throw new Error(ex.error);
		const doc = fromExchange(ex.exchange);
		const deps = Object.values(doc.dependenciesById);
		expect(deps).toHaveLength(1);
		expect(deps[0].from.port).toBe("start");
		expect(deps[0].to.port).toBe("finish");
	});

	it("rebuilds nested groups from the groups array", () => {
		const ex = parseExchange({
			format: EXCHANGE_FORMAT_ID,
			schemaVersion: 1,
			exportedAt: "x",
			title: "p",
			groups: [
				{ id: "outer", name: "Outer", parentGroupId: null, order: 0 },
				{ id: "inner", name: "Inner", parentGroupId: "outer", order: 0 },
			],
			tasks: [{ id: "a", kind: "task", title: "A", groupId: "inner" }],
		});
		if (!ex.ok) throw new Error(ex.error);
		const doc = fromExchange(ex.exchange);
		expect(doc.groupsById.inner.parentGroupId).toBe("outer");
		expect(doc.tasksById.a.groupId).toBe("inner");
	});

	it("respects a title override on import", () => {
		const ex = toExchange(richDoc());
		const rebuilt = fromExchange(ex, { title: "  Renamed  " });
		expect(rebuilt.title).toBe("Renamed");
	});

	it("falls back to the exchange title when override is blank", () => {
		const ex = toExchange(richDoc());
		const rebuilt = fromExchange(ex, { title: "   " });
		expect(rebuilt.title).toBe("Q3 launch");
	});
});

describe("summarizeExchange", () => {
	it("counts tasks, milestones, groups, and inline deps", () => {
		const summary = summarizeExchange(toExchange(richDoc()));
		expect(summary).toEqual({
			title: "Q3 launch",
			taskCount: 1,
			milestoneCount: 1,
			groupCount: 1,
			dependencyCount: 1,
			hasCalendar: true,
		});
	});
});

describe("suggestExportFilename", () => {
	it("slugifies the title", () => {
		expect(suggestExportFilename("Q3 Launch — Apps & Web")).toBe(
			"q3-launch-apps-web.pert.json",
		);
	});

	it("falls back when the title has no slug-safe characters", () => {
		expect(suggestExportFilename("///")).toBe("project.pert.json");
	});

	it("caps the slug at 60 chars", () => {
		const long = "a".repeat(120);
		const out = suggestExportFilename(long);
		expect(out).toBe(`${"a".repeat(60)}.pert.json`);
	});
});

describe("JSON Schema artifact (exchange.schema.json)", () => {
	const schema = schemaJson as unknown as Record<string, unknown>;
	const defs = schema.$defs as Record<string, unknown>;

	it("declares the same $id the runtime advertises", () => {
		expect(schema.$id).toBe(EXCHANGE_SCHEMA_URL);
	});

	it("pins format=pert.li and schemaVersion=1 with `const` discriminators", () => {
		const props = schema.properties as Record<string, Record<string, unknown>>;
		expect(props.format.const).toBe(EXCHANGE_FORMAT_ID);
		expect(props.schemaVersion.const).toBe(EXCHANGE_SCHEMA_VERSION);
	});

	it("describes every domain definition the format references", () => {
		for (const name of [
			"TaskKind",
			"TaskStatus",
			"EstimateUnit",
			"DependencyType",
			"Estimate",
			"DependsOnEntry",
			"Group",
			"Task",
			"Calendar",
		]) {
			expect(defs[name]).toBeDefined();
		}
	});

	it("requires taskId on DependsOnEntry and forbids extra fields", () => {
		const dep = defs.DependsOnEntry as {
			required: string[];
			additionalProperties: boolean;
		};
		expect(dep.required).toEqual(["taskId"]);
		expect(dep.additionalProperties).toBe(false);
	});

	it("does NOT define a top-level 'dependencies' property", () => {
		const props = schema.properties as Record<string, unknown>;
		expect(props.dependencies).toBeUndefined();
	});
});

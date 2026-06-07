import * as Automerge from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { applyOperations } from "../apply-operations";
import type { EditOp } from "../operations";

// These tests run applyOperations against a REAL Automerge change proxy, which
// is where the work-plan `propose_changes` auto-apply path actually executes.
// The existing proposals-store tests only exercise plain-JS objects, so they
// never catch Automerge's "assign undefined value" RangeError — the exact
// failure that crashed work-plan execution.

describe("applyOperations on a live Automerge doc", () => {
	it("applies a valid add_task batch without throwing", () => {
		let doc = Automerge.from<PertDoc>(createEmptyPertDoc("repro"));
		const ops: EditOp[] = [
			{ op: "add_task", id: "scope", title: "Scope", kind: "container" },
			{ op: "add_task", id: "feat", title: "Features", parentId: "scope" },
		];
		let results: ReturnType<typeof applyOperations> = [];
		expect(() => {
			doc = Automerge.change(doc, (d) => {
				results = applyOperations(d, ops);
			});
		}).not.toThrow();
		expect(results.every((r) => r.ok)).toBe(true);
		expect(doc.tasksById.scope?.title).toBe("Scope");
		expect(doc.tasksById.feat?.parentId).toBe("scope");
	});

	it("does NOT crash the whole change when one op carries an undefined property", () => {
		let doc = Automerge.from<PertDoc>(createEmptyPertDoc("repro"));
		// A malformed add_task missing `title` — exactly what slips through the
		// unvalidated client tool boundary. `title: undefined` is legal in the
		// plain-JS staging clone but Automerge rejects it on the live proxy.
		const badOp = { op: "add_task", id: "bad" } as unknown as EditOp;
		const ops: EditOp[] = [
			{ op: "add_task", id: "good", title: "Good", kind: "container" },
			badOp,
			{ op: "add_task", id: "good2", title: "Good 2", parentId: "good" },
		];
		let results: ReturnType<typeof applyOperations> = [];
		expect(() => {
			doc = Automerge.change(doc, (d) => {
				results = applyOperations(d, ops);
			});
		}).not.toThrow();
		// The valid ops still applied...
		expect(doc.tasksById.good?.title).toBe("Good");
		expect(doc.tasksById.good2?.parentId).toBe("good");
		// ...and the bad op surfaced as a failure row, not a thrown exception.
		const bad = results.find((r) => !r.ok);
		expect(bad).toBeDefined();
	});

	it("contains non-object batch entries (null/primitive/missing op) without aborting", () => {
		// The pre-scans, remap, and post-batch normalisation all read `op.op`
		// directly; a null/primitive/discriminator-less entry would throw there —
		// before runOpSafe's guard — and abort the whole Automerge change.
		let doc = Automerge.from<PertDoc>(createEmptyPertDoc("repro"));
		const ops = [
			{ op: "add_task", id: "good", title: "Good", kind: "container" },
			null,
			"not-an-op",
			42,
			{ id: "no-discriminator", title: "Missing op" },
			{ op: "totally_unknown", taskId: "x" },
			{ op: "add_task", id: "good2", title: "Good 2", parentId: "good" },
		] as unknown as EditOp[];
		let results: ReturnType<typeof applyOperations> = [];
		expect(() => {
			doc = Automerge.change(doc, (d) => {
				results = applyOperations(d, ops);
			});
		}).not.toThrow();
		// One result per input op (index alignment preserved).
		expect(results).toHaveLength(ops.length);
		// The two valid container/child ops applied, child still parented.
		expect(doc.tasksById.good?.title).toBe("Good");
		expect(doc.tasksById.good2?.parentId).toBe("good");
		// The five malformed entries each became a failed row.
		expect(results.filter((r) => !r.ok)).toHaveLength(5);
	});
});

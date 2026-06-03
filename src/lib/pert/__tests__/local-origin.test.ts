import { beforeEach, describe, expect, it } from "vitest";
import {
	type ChangeFn,
	clearLocallyCreated,
	consumeLocallyCreated,
	withLocalOriginTracking,
} from "#/lib/pert/store";
import {
	createEmptyPertDoc,
	type PertDoc,
	type Task,
	type TaskId,
} from "#/lib/pert/types";

// Builds a `changeDoc` that mutates a single in-memory doc, mimicking the
// Automerge handle.change() contract: the mutator runs against the live draft.
function makeChangeDoc(doc: PertDoc): ChangeFn {
	return (mutate) => mutate(doc);
}

function leaf(id: TaskId): Task {
	return { id, kind: "task", title: id, parentId: null };
}

describe("local-origin tracking", () => {
	beforeEach(() => clearLocallyCreated());

	it("records tasks added through a wrapped changeDoc", () => {
		const doc = createEmptyPertDoc("t");
		const changeDoc = withLocalOriginTracking(makeChangeDoc(doc));

		changeDoc((d) => {
			d.tasksById["task-a" as TaskId] = leaf("task-a" as TaskId);
		});

		// consume returns true exactly once, then false (no unbounded growth).
		expect(consumeLocallyCreated("task-a" as TaskId)).toBe(true);
		expect(consumeLocallyCreated("task-a" as TaskId)).toBe(false);
	});

	it("does NOT record tasks added by a remote-style mutation (bypassing the wrapper)", () => {
		const doc = createEmptyPertDoc("t");
		const remoteApply = makeChangeDoc(doc); // unwrapped == arrives via sync

		remoteApply((d) => {
			d.tasksById["remote-1" as TaskId] = leaf("remote-1" as TaskId);
		});

		expect(consumeLocallyCreated("remote-1" as TaskId)).toBe(false);
	});

	it("records every task added in a multi-task batch but ignores edits to existing tasks", () => {
		const doc = createEmptyPertDoc("t");
		doc.tasksById["existing" as TaskId] = leaf("existing" as TaskId);
		const changeDoc = withLocalOriginTracking(makeChangeDoc(doc));

		changeDoc((d) => {
			d.tasksById["b" as TaskId] = leaf("b" as TaskId);
			d.tasksById["c" as TaskId] = leaf("c" as TaskId);
			// Editing a pre-existing task is not a creation.
			d.tasksById["existing" as TaskId].title = "renamed";
		});

		expect(consumeLocallyCreated("b" as TaskId)).toBe(true);
		expect(consumeLocallyCreated("c" as TaskId)).toBe(true);
		expect(consumeLocallyCreated("existing" as TaskId)).toBe(false);
	});

	it("records an added task even when another is removed in the same call (count unchanged)", () => {
		const doc = createEmptyPertDoc("t");
		doc.tasksById["old" as TaskId] = leaf("old" as TaskId);
		const changeDoc = withLocalOriginTracking(makeChangeDoc(doc));

		// A replace-style mutation: count stays at 1, so a count-based shortcut
		// would miss the new task. The set diff must still catch it.
		changeDoc((d) => {
			delete d.tasksById["old" as TaskId];
			d.tasksById["new" as TaskId] = leaf("new" as TaskId);
		});

		expect(consumeLocallyCreated("new" as TaskId)).toBe(true);
	});

	it("clearLocallyCreated drops pending entries (project unmount)", () => {
		const doc = createEmptyPertDoc("t");
		const changeDoc = withLocalOriginTracking(makeChangeDoc(doc));
		changeDoc((d) => {
			d.tasksById["x" as TaskId] = leaf("x" as TaskId);
		});

		clearLocallyCreated();

		expect(consumeLocallyCreated("x" as TaskId)).toBe(false);
	});
});

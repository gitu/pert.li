import { describe, it } from "vitest";
import { createGroupMutation } from "../../tool-mutators";
import { assertValidArgs, calledTool, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Tool-call correctness: "add X to group Y" should produce a real task that
// joins group Y — via add_task (groupId) or a propose_changes batch — with
// valid args.
describe.skipIf(!isProviderConfigured())("eval: add_task", () => {
	it("adds a task to the named group", async () => {
		await repeat("add a task to the Backend group", async () => {
			const run = await runScenario({
				name: "add-task",
				title: "Web app",
				seed: (doc) => {
					createGroupMutation(doc, { id: "backend", name: "Backend" });
				},
				messages: [
					{
						role: "user",
						content: 'Add a task called "Write docs" to the Backend group.',
					},
				],
			});

			assertValidArgs(run);
			const added = Object.values(run.finalDoc.tasksById).find(
				(t) => /write docs/i.test(t.title) && t.groupId === "backend",
			);
			const usedWriteTool =
				calledTool(run, "add_task") || calledTool(run, "propose_changes");
			return Boolean(added) && usedWriteTool;
		});
	});
});

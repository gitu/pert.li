import { describe, it } from "vitest";
import { addTaskMutation } from "../../tool-mutators";
import { assertValidArgs, calledTool, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Tool-call correctness: "add X under container Y" should produce a real task
// parented to Y — via add_task or a propose_changes batch — with valid args.
describe.skipIf(!isProviderConfigured())("eval: add_task", () => {
	it("adds a task under the named container", async () => {
		await repeat("add a task under the Backend container", async () => {
			const run = await runScenario({
				name: "add-task",
				title: "Web app",
				seed: (doc) => {
					addTaskMutation(
						doc,
						{ title: "Backend", kind: "container" },
						"backend",
					);
				},
				messages: [
					{
						role: "user",
						content:
							'Add a task called "Write docs" under the Backend container.',
					},
				],
			});

			assertValidArgs(run);
			const added = Object.values(run.finalDoc.tasksById).find(
				(t) => /write docs/i.test(t.title) && t.parentId === "backend",
			);
			const usedWriteTool =
				calledTool(run, "add_task") || calledTool(run, "propose_changes");
			return Boolean(added) && usedWriteTool;
		});
	});
});

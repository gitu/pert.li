import { describe, it } from "vitest";
import { addTaskMutation } from "../../tool-mutators";
import { assertValidArgs, calledTool, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Tool-call correctness on a 2-step trajectory: the model must read the project
// to resolve the two task ids, then wire the edge in the correct DIRECTION
// (Build → Deploy), not the reverse.
describe.skipIf(!isProviderConfigured())("eval: add_dependency", () => {
	it("wires Deploy to depend on Build, in the right direction", async () => {
		await repeat("make Deploy depend on Build", async () => {
			const run = await runScenario({
				name: "dependency",
				title: "Release",
				seed: (doc) => {
					addTaskMutation(doc, { title: "Build", kind: "task" }, "build");
					addTaskMutation(doc, { title: "Deploy", kind: "task" }, "deploy");
				},
				messages: [
					{
						role: "user",
						content:
							"Deploy can't start until Build is finished. Add that dependency.",
					},
				],
			});

			assertValidArgs(run);
			const wired = Object.values(run.finalDoc.dependenciesById).some(
				(d) => d.from.taskId === "build" && d.to.taskId === "deploy",
			);
			const usedDepTool =
				calledTool(run, "add_dependency") || calledTool(run, "propose_changes");
			return wired && usedDepTool;
		});
	});
});

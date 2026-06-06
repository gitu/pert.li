import { describe, it } from "vitest";
import { addTaskMutation } from "../../tool-mutators";
import { assertValidArgs, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Tool-call correctness: "I finished X" should flip the task to completed (via
// set_status or set_progress=100, both of which the mutators normalise to
// completed). Asserted on final doc state, so either tool path counts.
describe.skipIf(!isProviderConfigured())("eval: set_status", () => {
	it("marks the named task completed", async () => {
		await repeat("mark the Login task completed", async () => {
			const run = await runScenario({
				name: "status",
				title: "Auth feature",
				seed: (doc) => {
					addTaskMutation(doc, { title: "Login", kind: "task" }, "login");
				},
				messages: [
					{
						role: "user",
						content: "I just finished the Login task — mark it as completed.",
					},
				],
			});

			assertValidArgs(run);
			return run.finalDoc.tasksById.login?.status === "completed";
		});
	});
});

import { describe, it } from "vitest";
import { addTaskMutation } from "../../tool-mutators";
import { assertValidArgs, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Tool-call correctness: a three-point estimate request should land the exact
// numbers on the right task (via set_estimate or propose_changes).
describe.skipIf(!isProviderConfigured())("eval: set_estimate", () => {
	it("applies a 2/3/5-day three-point estimate to the named task", async () => {
		await repeat("estimate the login task at 2/3/5 days", async () => {
			const run = await runScenario({
				name: "estimate",
				title: "Web app",
				seed: (doc) => {
					addTaskMutation(doc, { title: "Login flow", kind: "task" }, "login");
				},
				messages: [
					{
						role: "user",
						content:
							"Set the estimate for the Login flow task to 2 days optimistic, 3 most likely, 5 pessimistic.",
					},
				],
			});

			assertValidArgs(run);
			const est = run.finalDoc.tasksById.login?.estimate;
			return (
				!!est &&
				est.optimistic === 2 &&
				est.mostLikely === 3 &&
				est.pessimistic === 5 &&
				est.unit === "day"
			);
		});
	});
});

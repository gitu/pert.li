import { describe, it } from "vitest";
import { addTaskMutation } from "../../tool-mutators";
import { assertValidArgs, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Tool-call correctness: linking a task to an external ticket should land the
// issue key on the task (via set_issue_links, or a set_issue_links op inside a
// propose_changes batch). Asserted on final doc state, so either path counts.
describe.skipIf(!isProviderConfigured())("eval: set_issue_links", () => {
	it("links the named task to a Jira key", async () => {
		await repeat("link the Login task to PROJ-123", async () => {
			const run = await runScenario({
				name: "issue-links",
				title: "Auth feature",
				seed: (doc) => {
					addTaskMutation(doc, { title: "Login", kind: "task" }, "login");
				},
				messages: [
					{
						role: "user",
						content:
							"Link the Login task to the Jira ticket PROJ-123 so we can jump to it.",
					},
				],
			});

			assertValidArgs(run);
			return Boolean(
				run.finalDoc.tasksById.login?.issueKeys?.includes("PROJ-123"),
			);
		});
	});
});

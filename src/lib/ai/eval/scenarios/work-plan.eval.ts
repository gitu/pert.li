import { describe, it } from "vitest";
import { assertValidArgs, calledTool, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Tool selection: a large, multi-step import/restructure is exactly what
// create_work_plan exists for. The model should draft a plan (and stop for
// approval) rather than firing dozens of individual edits.
describe.skipIf(!isProviderConfigured())("eval: create_work_plan", () => {
	it("drafts a work plan for a large structured import", async () => {
		await repeat("draft a work plan for a big import", async () => {
			const run = await runScenario({
				name: "work-plan",
				title: "Platform migration",
				messages: [
					{
						role: "user",
						content:
							"I need to import a large spec: roughly 30 tasks across 5 phases with dependencies between phases. Set up a structured, step-by-step plan to build it out so I can approve it before you start.",
					},
				],
			});

			assertValidArgs(run);
			return calledTool(run, "create_work_plan") && !!run.finalDoc.workPlan;
		});
	});
});

import { describe, it } from "vitest";
import { assertValidArgs, repeat } from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Multi-step trajectory: a "break this down" ask should produce several real
// tasks AND wire at least one dependency (via individual tools or a
// propose_changes batch). Asserted on the final doc, so the tool path is free.
describe.skipIf(!isProviderConfigured())("eval: project breakdown", () => {
	it("creates several tasks and at least one dependency", async () => {
		await repeat(
			"break down a REST API build into tasks + dependencies",
			async () => {
				const run = await runScenario({
					name: "breakdown",
					title: "REST API",
					messages: [
						{
							role: "user",
							content:
								"Break down building a small REST API into about 4 tasks, and add dependencies so they run in a sensible order.",
						},
					],
				});

				assertValidArgs(run);
				const tasks = Object.values(run.finalDoc.tasksById).filter(
					(t) => t.kind !== "container",
				).length;
				const deps = Object.keys(run.finalDoc.dependenciesById).length;
				return tasks >= 3 && deps >= 1;
			},
		);
	});
});

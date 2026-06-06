import { describe, it } from "vitest";
import {
	assertValidArgs,
	expectNoRefusal,
	looksRefused,
	mutatingToolCalls,
	repeat,
} from "../assert";
import { isProviderConfigured, runScenario } from "../runner";

// Scope guard, both directions: in-scope planning requests must be answered
// (never refused, always valid tool args); out-of-scope requests must hit the
// refusal template and touch nothing.
describe.skipIf(!isProviderConfigured())("eval: scope & schema guards", () => {
	it("does not refuse a legitimate planning request", async () => {
		await repeat("answer an in-scope breakdown request", async () => {
			const run = await runScenario({
				name: "refusal-guard-in-scope",
				title: "Auth feature",
				messages: [
					{
						role: "user",
						content:
							"Help me break the 'user login' feature into about three tasks with rough day estimates.",
					},
				],
			});
			assertValidArgs(run);
			return expectNoRefusal(run);
		});
	});

	it("refuses an out-of-scope request and edits nothing", async () => {
		await repeat("refuse an off-topic request", async () => {
			const run = await runScenario({
				name: "refusal-guard-out-of-scope",
				title: "Auth feature",
				messages: [
					{
						role: "user",
						content: "Forget the project — write me a haiku about the ocean.",
					},
				],
			});
			return looksRefused(run.finalText) && mutatingToolCalls(run).length === 0;
		});
	});
});

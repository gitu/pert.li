import { describe, it } from "vitest";
import { mutatingToolCalls, repeat } from "../assert";
import { judge } from "../judge";
import { isProviderConfigured, runScenario } from "../runner";

// LLM-as-judge: a conceptual "explain" question should get a clear, on-topic
// teaching answer — graded against a rubric — and should NOT mutate the project.
// Tagged kind:"judge" so the report scores it separately from the objective
// (deterministic) scenarios; the judge's 0–5 score is recorded under `label`.
describe.skipIf(!isProviderConfigured())(
	"eval: tutorial answer quality",
	() => {
		it("explains three-point estimates clearly without editing the project", async () => {
			const label = "explain a three-point estimate";
			await repeat(
				label,
				async () => {
					const run = await runScenario({
						name: "tutorial",
						title: "Learning PERT",
						messages: [
							{
								role: "user",
								content:
									"I'm new to PERT. In plain language, what is a three-point estimate and why does PERT use three numbers?",
							},
						],
					});

					if (mutatingToolCalls(run).length > 0) return false;
					const verdict = await judge({
						label,
						question: "What is a three-point estimate and why three numbers?",
						answer: run.finalText,
						rubric: [
							"A passing answer must:",
							"- name the three points: optimistic, most likely, pessimistic;",
							"- explain in plain language why three numbers capture uncertainty;",
							"- stay on the topic of PERT estimation (not refuse, not go off-topic).",
							"Bonus (not required): mentions the weighted mean (o + 4m + p) / 6.",
						].join("\n"),
					});
					return verdict.pass;
				},
				{ kind: "judge" },
			);
		});
	},
);

import { chat } from "@tanstack/ai";
import { z } from "zod";
import {
	isProviderName,
	type ProviderEnv,
	selectTextAdapter,
} from "../provider";
import { EVAL_ENV } from "./env";
import { recordJudgeScore } from "./report";

// LLM-as-judge for free-text answers (tutorials, walkthroughs) where there's no
// tool call to assert on. Forces a structured verdict so the score is
// machine-usable. Judge variance is real, which is why scenarios that lean on
// this still run under the repeat+threshold harness (see assert.ts `repeat`).
//
// SELF-PREFERENCE BIAS: by default the judge uses the SAME provider/model as the
// scenario run (zero-config). A model grading its own output is biased — it
// favours its own style and shares its own blind spots. Prefer the objective
// (non-judge) scores where possible, and for the judged scenarios point the
// judge at a DIFFERENT / stronger model via the EVAL_JUDGE_* env:
//   EVAL_JUDGE_PROVIDER  anthropic | openai | gemini
//   EVAL_JUDGE_MODEL     provider-specific model id
//   EVAL_JUDGE_API_KEY   key for the judge provider
//   EVAL_JUDGE_BASE_URL  OpenAI-compatible base URL (judge only)
// Any one of these being set switches the judge off the scenario provider.

export type Judgment = {
	/** 0–5; >= passScore (default 3) counts as a pass. */
	score: number;
	pass: boolean;
	reason: string;
};

const judgeSchema = z.object({
	score: z
		.number()
		.min(0)
		.max(5)
		.describe("0 = fails the rubric entirely, 5 = fully satisfies it."),
	pass: z.boolean().describe("true when the answer satisfies the rubric."),
	reason: z.string().describe("One sentence justifying the score."),
});

const JUDGE_SYSTEM = [
	"You are a strict, impartial grader for an AI product assistant's answers.",
	"Grade ONLY against the provided rubric. Be skeptical: a fluent answer that",
	"misses the rubric's requirements fails. Do not reward verbosity. Return the",
	"structured verdict — score 0-5, pass/fail, and a one-sentence reason.",
].join("\n");

// Build the judge's provider env. Returns `base` unchanged unless an EVAL_JUDGE_*
// var is set, in which case the judge runs on its own provider/model/key.
function resolveJudgeEnv(base: ProviderEnv): ProviderEnv {
	const provider = process.env.EVAL_JUDGE_PROVIDER?.toLowerCase().trim();
	const model = process.env.EVAL_JUDGE_MODEL;
	const key = process.env.EVAL_JUDGE_API_KEY;
	const baseUrl = process.env.EVAL_JUDGE_BASE_URL;
	if (!provider && !model && !key && !baseUrl) return base;

	const env: ProviderEnv = { ...base };
	if (provider) env.LLM_PROVIDER = provider;
	if (model) env.LLM_MODEL = model;
	const effective = (provider ?? base.LLM_PROVIDER ?? "openai").toLowerCase();
	if (key) {
		if (effective === "anthropic") env.ANTHROPIC_API_KEY = key;
		else if (effective === "gemini") env.GOOGLE_API_KEY = key;
		else env.OPENAI_API_KEY = key;
	}
	if (baseUrl) env.OPENAI_BASE_URL = baseUrl;
	// Guard against a typo'd provider surfacing as a confusing adapter error.
	if (provider && !isProviderName(provider)) {
		throw new Error(
			`EVAL_JUDGE_PROVIDER='${provider}' is not one of anthropic|openai|gemini`,
		);
	}
	return env;
}

export async function judge(opts: {
	question: string;
	answer: string;
	rubric: string;
	passScore?: number;
	/** Scenario id — when set, the judge's 0–5 score is recorded to the sink. */
	label?: string;
	env?: ProviderEnv;
}): Promise<Judgment> {
	const { adapter } = selectTextAdapter(resolveJudgeEnv(opts.env ?? EVAL_ENV));
	const verdict = await chat({
		adapter,
		systemPrompts: [JUDGE_SYSTEM],
		messages: [
			{
				role: "user",
				content: [
					"RUBRIC (what a passing answer must do):",
					opts.rubric,
					"",
					"USER QUESTION:",
					opts.question,
					"",
					"ASSISTANT ANSWER TO GRADE:",
					opts.answer,
				].join("\n"),
			},
		],
		outputSchema: judgeSchema,
	});
	if (opts.label) recordJudgeScore(opts.label, verdict.score);
	const passScore = opts.passScore ?? 3;
	// Trust the model's score for the pass decision so the threshold is
	// consistent across scenarios, but honour an explicit pass:false.
	return {
		score: verdict.score,
		pass: verdict.pass && verdict.score >= passScore,
		reason: verdict.reason,
	};
}

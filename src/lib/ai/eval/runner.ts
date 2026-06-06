import { chat, maxIterations } from "@tanstack/ai";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import {
	type ProviderEnv,
	resolveProvider,
	selectTextAdapter,
} from "../provider";
import { AGENT_MAX_ITERATIONS, SYSTEM_PROMPT } from "../system-prompt";
import { buildEvalTools, type ToolCall } from "./build-server-tools";
import { EVAL_ENV } from "./env";

// Headless scenario runner. Drives the REAL system prompt + REAL chat tools
// through the REAL `chat()` agent loop against whichever provider `env`
// selects (Gemini in CI; any OpenAI-compatible self-hosted endpoint locally),
// then hands back the full tool-call trajectory, the final assistant text, and
// the mutated in-memory doc so a scenario can assert on all three.

export type ScenarioMessage = {
	role: "user" | "assistant";
	content: string;
};

export type Scenario = {
	/** Stable id used in reports and assertions. */
	name: string;
	/** Title for the seed project doc. */
	title?: string;
	/**
	 * Populate the starting project state by calling the same mutators the
	 * tools use (e.g. addTaskMutation). Runs before the model sees the doc, so
	 * `read_project` returns this state.
	 */
	seed?: (doc: PertDoc) => void;
	/** Conversation turns sent to the model (usually a single user message). */
	messages: ScenarioMessage[];
};

export type ScenarioRun = {
	toolCalls: ToolCall[];
	finalText: string;
	finalDoc: PertDoc;
	provider: string;
	model: string;
};

/**
 * True when `env` selects a usable LLM provider (a key is present, or
 * LLM_PROVIDER + its key). Scenarios use this with `describe.skipIf` so
 * `pnpm eval` with no key skips cleanly instead of erroring on every test.
 */
export function isProviderConfigured(env: ProviderEnv = EVAL_ENV): boolean {
	try {
		resolveProvider(env);
		return true;
	} catch {
		return false;
	}
}

export async function runScenario(
	scenario: Scenario,
	env: ProviderEnv = EVAL_ENV,
): Promise<ScenarioRun> {
	const { adapter, config } = selectTextAdapter(env);
	const doc = createEmptyPertDoc(scenario.title ?? "Eval project");
	scenario.seed?.(doc);

	const record: ToolCall[] = [];
	const tools = buildEvalTools(doc, record, config.provider);

	const finalText = await chat({
		adapter,
		messages: scenario.messages,
		systemPrompts: [SYSTEM_PROMPT],
		// Headless tools carry `.server()` executors so the loop runs locally.
		// biome-ignore lint/suspicious/noExplicitAny: chat()'s tools generic over-narrows the structural Tool[] our factory returns.
		tools: tools as any,
		stream: false,
		agentLoopStrategy: maxIterations(AGENT_MAX_ITERATIONS),
	});

	return {
		toolCalls: record,
		finalText,
		finalDoc: doc,
		provider: config.provider,
		model: config.model,
	};
}

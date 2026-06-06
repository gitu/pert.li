import { resolve } from "node:path";
import {
	chat,
	chatParamsFromRequest,
	maxIterations,
	mergeAgentTools,
	toServerSentEventsResponse,
} from "@tanstack/ai";
import dotenv from "dotenv";
import { traceChatRequest, traceChatStream } from "#/lib/ai/chat-debug.server";
import { toGeminiCompatibleTools } from "#/lib/ai/gemini-compat";
import { toOpenAiCompatibleTools } from "#/lib/ai/openai-compat";
import {
	type ProviderEnv,
	type ProviderName,
	selectTextAdapter,
} from "#/lib/ai/provider";
import { AGENT_MAX_ITERATIONS, SYSTEM_PROMPT } from "#/lib/ai/system-prompt";
import { requireSessionFromHeaders } from "#/server/auth-context.server";

// Vite's environment runner sandboxes `process.env` inside the dev worker —
// dotenv parses our .env files but the writes don't reach `globalThis.process.env`
// that handler code sees. So we parse the files ourselves and pass the merged
// env to `selectTextAdapter`. The merge order is: process.env (lowest) →
// .env → .env.local (highest), so per-developer secrets win.
const rootDir = process.env.PROJECT_ROOT ?? process.cwd();
const dotEnv =
	dotenv.config({ path: resolve(rootDir, ".env"), quiet: true }).parsed ?? {};
const dotEnvLocal =
	dotenv.config({ path: resolve(rootDir, ".env.local"), quiet: true }).parsed ??
	{};
// Exported so the one-shot summary server fn (src/server/ai-summary.ts) reuses
// the same dotenv/Vite-sandbox env merge instead of duplicating it.
export const SERVER_ENV: ProviderEnv = {
	...(process.env as ProviderEnv),
	...dotEnv,
	...dotEnvLocal,
};

// Server-only chat handler. Picks an adapter from env, parses an AG-UI
// `RunAgentInput` body off the request, and streams back over SSE. UI
// clients consume the stream via `useChat({ connection: fetchServerSentEvents(...) })`.
//
// The system prompt (SYSTEM_PROMPT) and the agent-loop bound
// (AGENT_MAX_ITERATIONS) live in ./system-prompt.ts — a dependency-free module
// so the headless eval harness (./eval/) can reuse the exact production prompt
// without importing this server/auth graph.

// Tool input schemas are serialized from Zod on the client, and not every
// provider accepts the full JSON Schema dialect Zod emits:
//   • Gemini's function-declaration proto rejects `const` (emitted for every
//     z.literal(), e.g. the `op` discriminators in propose_changes'
//     operations array) → rewritten to single-value `enum`.
//   • OpenAI structured output (strict function calling) rejects `oneOf`
//     (emitted for every z.discriminatedUnion()) → rewritten to the
//     semantically-equivalent `anyOf`, plus the same `const` → `enum`
//     rewrite for OpenAI-compatible gateways behind OPENAI_BASE_URL.
//   • Anthropic accepts the raw schemas as-is.
function toProviderCompatibleTools(
	tools: ReturnType<typeof mergeAgentTools>,
	provider: ProviderName,
): ReturnType<typeof mergeAgentTools> {
	switch (provider) {
		case "gemini":
			return toGeminiCompatibleTools(tools);
		case "openai":
			return toOpenAiCompatibleTools(tools);
		case "anthropic":
			return tools;
	}
}

export async function handleChatRequest(request: Request): Promise<Response> {
	// Gate every call on an authenticated session: the LLM adapter below uses
	// server-held provider keys, so any anonymous caller would be spending the
	// operator's API budget. Throws UnauthorizedError (401) when there's no
	// session — handled below so the route can return a 401 response instead
	// of a 500.
	try {
		await requireSessionFromHeaders(request.headers);
	} catch {
		return new Response("Unauthorized", { status: 401 });
	}
	const params = await chatParamsFromRequest(request);
	const { adapter, config } = selectTextAdapter(SERVER_ENV);
	// All chat tools are client-executed (they mutate the browser-side
	// Automerge doc). We expose them to the model via mergeAgentTools, which
	// turns the client-declared tool list into no-execute entries — the
	// runtime then ferries each tool call back to the browser, waits for
	// `addToolResult(...)`, and continues the agent loop.
	const merged = mergeAgentTools([], params.tools);
	const tools = toProviderCompatibleTools(merged, config.provider);
	// Trace the request + stream so tool-use failures (gateway schema
	// rejections, malformed tool calls, run errors) are diagnosable from the
	// server side. See chat-debug.server.ts for sinks.
	traceChatRequest({
		provider: config.provider,
		model: config.model,
		threadId: params.threadId,
		runId: params.runId,
		messageCount: params.messages.length,
		toolNames: tools.map((t) => t.name),
	});
	const stream = chat({
		adapter,
		messages: params.messages,
		systemPrompts: [SYSTEM_PROMPT],
		tools,
		// Stream is the default but make it explicit so it shows up in code review.
		stream: true,
		// The library default is maxIterations(5) — far too low for work-plan
		// execution, where one turn marks a step in_progress, stages+applies its
		// operations, marks it completed, and moves on to the next step. Each
		// iteration is one model round-trip on the operator's API budget, so the
		// cap still bounds runaway loops.
		agentLoopStrategy: maxIterations(AGENT_MAX_ITERATIONS),
	});
	const traced = traceChatStream(stream, {
		runId: params.runId,
		provider: config.provider,
		model: config.model,
	});
	return toServerSentEventsResponse(traced, {
		headers: {
			"x-llm-provider": config.provider,
			"x-llm-model": config.model,
		},
	});
}

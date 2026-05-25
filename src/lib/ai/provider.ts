import type { AnyTextAdapter } from "@tanstack/ai";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { createGeminiChat } from "@tanstack/ai-gemini";
import { createOpenaiChat } from "@tanstack/ai-openai";

// Unified LLM provider selection. `@tanstack/ai`'s `chat()` already speaks to
// any adapter; this module just picks one based on env. Adding a fourth
// provider means: install its `@tanstack/ai-<x>` package, import its
// `xText()` factory, and add a branch below.
//
// Env contract (set one provider + its key, or set LLM_PROVIDER to force):
//
//   LLM_PROVIDER     anthropic | openai | gemini  (defaults to first
//                                                  whose key is present,
//                                                  in that order)
//   LLM_MODEL        provider-specific model id   (defaults below)
//   ANTHROPIC_API_KEY
//   OPENAI_API_KEY
//   OPENAI_BASE_URL  optional — override the OpenAI API endpoint. Lets you
//                    point at Azure OpenAI, OpenRouter, LM Studio, Ollama,
//                    vLLM, or any other OpenAI-compatible /v1 server.
//   GOOGLE_API_KEY  (Gemini also accepts GEMINI_API_KEY)
//
// The adapter creators read API keys from process.env themselves — we just
// pass the model name. That keeps secrets off any object we'd want to log.

export type ProviderName = "anthropic" | "openai" | "gemini";

export type ProviderConfig = {
	provider: ProviderName;
	model: string;
};

export const DEFAULT_MODELS: Record<ProviderName, string> = {
	anthropic: "claude-sonnet-4-6",
	openai: "gpt-5-mini",
	// Note: Gemini model ids use dots (e.g. `gemini-2.5-flash`), not dashes.
	gemini: "gemini-2.5-flash",
};

export type ProviderEnv = Partial<{
	LLM_PROVIDER: string;
	LLM_MODEL: string;
	ANTHROPIC_API_KEY: string;
	OPENAI_API_KEY: string;
	OPENAI_BASE_URL: string;
	GOOGLE_API_KEY: string;
	GEMINI_API_KEY: string;
}>;

// Pure selection used by both runtime and tests. Throws a clear error when
// no provider is configured.
export function resolveProvider(env: ProviderEnv): ProviderConfig {
	const explicit = env.LLM_PROVIDER?.toLowerCase().trim();
	if (explicit) {
		if (!isProviderName(explicit)) {
			throw new Error(
				`LLM_PROVIDER='${explicit}' is not one of anthropic|openai|gemini`,
			);
		}
		assertKey(explicit, env);
		return {
			provider: explicit,
			model: env.LLM_MODEL ?? DEFAULT_MODELS[explicit],
		};
	}
	// Auto-detect: pick the first provider with a key.
	const detected = autoDetectProvider(env);
	if (!detected) {
		throw new Error(
			"No LLM provider configured. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY (or GEMINI_API_KEY), or set LLM_PROVIDER explicitly.",
		);
	}
	return {
		provider: detected,
		model: env.LLM_MODEL ?? DEFAULT_MODELS[detected],
	};
}

function autoDetectProvider(env: ProviderEnv): ProviderName | null {
	if (env.ANTHROPIC_API_KEY) return "anthropic";
	if (env.OPENAI_API_KEY) return "openai";
	if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) return "gemini";
	return null;
}

function assertKey(provider: ProviderName, env: ProviderEnv): void {
	switch (provider) {
		case "anthropic":
			if (!env.ANTHROPIC_API_KEY) throw missingKey("ANTHROPIC_API_KEY");
			return;
		case "openai":
			if (!env.OPENAI_API_KEY) throw missingKey("OPENAI_API_KEY");
			return;
		case "gemini":
			if (!env.GOOGLE_API_KEY && !env.GEMINI_API_KEY) {
				throw missingKey("GOOGLE_API_KEY (or GEMINI_API_KEY)");
			}
			return;
	}
}

function missingKey(name: string): Error {
	return new Error(`LLM provider selected but ${name} is not set in env.`);
}

export function isProviderName(value: string): value is ProviderName {
	return value === "anthropic" || value === "openai" || value === "gemini";
}

// Build a text adapter from a resolved config + the API key picked up from
// env. Each provider's `*Text()` factory implicitly reads process.env, which
// is sandboxed in some dev runtimes (Vite Environment Runner); the
// `create*Chat(model, apiKey)` variants take the key explicitly so handlers
// can pass it in. Model names are typed unions at the call site — at
// runtime we accept any string (so LLM_MODEL can swap models without a
// recompile) and cast at the boundary.
export function createTextAdapter(
	config: ProviderConfig,
	env: ProviderEnv,
): AnyTextAdapter {
	const model = unknownString(config.model);
	switch (config.provider) {
		case "anthropic":
			return createAnthropicChat(model, env.ANTHROPIC_API_KEY ?? "");
		case "openai": {
			const baseURL = env.OPENAI_BASE_URL?.trim();
			return createOpenaiChat(
				model,
				env.OPENAI_API_KEY ?? "",
				baseURL ? { baseURL } : undefined,
			);
		}
		case "gemini":
			return createGeminiChat(
				model,
				env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY ?? "",
			);
	}
}

// biome-ignore lint/suspicious/noExplicitAny: deliberate boundary cast for runtime-chosen model names.
function unknownString(value: string): any {
	return value;
}

// Convenience: full resolve + construct. Server code calls this once per
// request (adapter construction is cheap — no network).
export function selectTextAdapter(env: ProviderEnv = process.env): {
	adapter: AnyTextAdapter;
	config: ProviderConfig;
} {
	const config = resolveProvider(env);
	return { adapter: createTextAdapter(config, env), config };
}

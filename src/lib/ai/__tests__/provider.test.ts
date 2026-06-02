import { describe, expect, it, vi } from "vitest";
import {
	createTextAdapter,
	DEFAULT_MODELS,
	resolveOpenAiApiFormat,
	resolveProvider,
} from "#/lib/ai/provider";

vi.mock("@tanstack/ai-openai", () => ({
	createOpenaiChat: vi.fn((model, apiKey, config) => ({
		__kind: "openai-mock",
		model,
		apiKey,
		config,
	})),
	createOpenaiChatCompletions: vi.fn((model, apiKey, config) => ({
		__kind: "openai-chat-completions-mock",
		model,
		apiKey,
		config,
	})),
}));
vi.mock("@tanstack/ai-anthropic", () => ({
	createAnthropicChat: vi.fn((model, apiKey) => ({
		__kind: "anthropic-mock",
		model,
		apiKey,
	})),
}));
vi.mock("@tanstack/ai-gemini", () => ({
	createGeminiChat: vi.fn((model, apiKey) => ({
		__kind: "gemini-mock",
		model,
		apiKey,
	})),
}));

describe("resolveProvider — explicit LLM_PROVIDER", () => {
	it("respects LLM_PROVIDER=openai when key is set", () => {
		expect(
			resolveProvider({
				LLM_PROVIDER: "openai",
				OPENAI_API_KEY: "sk-test",
			}),
		).toEqual({ provider: "openai", model: DEFAULT_MODELS.openai });
	});

	it("respects LLM_PROVIDER=anthropic when key is set", () => {
		expect(
			resolveProvider({
				LLM_PROVIDER: "anthropic",
				ANTHROPIC_API_KEY: "sk-ant-test",
			}),
		).toEqual({ provider: "anthropic", model: DEFAULT_MODELS.anthropic });
	});

	it("respects LLM_PROVIDER=gemini with either GOOGLE_API_KEY or GEMINI_API_KEY", () => {
		expect(
			resolveProvider({
				LLM_PROVIDER: "gemini",
				GOOGLE_API_KEY: "test",
			}).provider,
		).toBe("gemini");
		expect(
			resolveProvider({
				LLM_PROVIDER: "gemini",
				GEMINI_API_KEY: "test",
			}).provider,
		).toBe("gemini");
	});

	it("LLM_MODEL overrides the default", () => {
		expect(
			resolveProvider({
				LLM_PROVIDER: "openai",
				LLM_MODEL: "gpt-4-turbo",
				OPENAI_API_KEY: "sk",
			}).model,
		).toBe("gpt-4-turbo");
	});

	it("LLM_PROVIDER is lowercased and trimmed", () => {
		expect(
			resolveProvider({
				LLM_PROVIDER: "  OpenAI  ",
				OPENAI_API_KEY: "sk",
			}).provider,
		).toBe("openai");
	});

	it("throws when LLM_PROVIDER is unknown", () => {
		expect(() =>
			resolveProvider({ LLM_PROVIDER: "cohere", OPENAI_API_KEY: "sk" }),
		).toThrow(/not one of/);
	});

	it("throws when LLM_PROVIDER is set but the matching key is missing", () => {
		expect(() => resolveProvider({ LLM_PROVIDER: "openai" })).toThrow(
			/OPENAI_API_KEY/,
		);
		expect(() => resolveProvider({ LLM_PROVIDER: "gemini" })).toThrow(
			/GOOGLE_API_KEY/,
		);
	});
});

describe("resolveProvider — auto-detect", () => {
	it("picks anthropic first when its key is present", () => {
		expect(
			resolveProvider({
				ANTHROPIC_API_KEY: "a",
				OPENAI_API_KEY: "b",
				GOOGLE_API_KEY: "c",
			}).provider,
		).toBe("anthropic");
	});

	it("falls through to openai when anthropic is absent", () => {
		expect(
			resolveProvider({ OPENAI_API_KEY: "b", GOOGLE_API_KEY: "c" }).provider,
		).toBe("openai");
	});

	it("falls through to gemini last", () => {
		expect(resolveProvider({ GEMINI_API_KEY: "c" }).provider).toBe("gemini");
	});

	it("throws when no keys are present", () => {
		expect(() => resolveProvider({})).toThrow(/No LLM provider configured/);
	});
});

describe("createTextAdapter — OpenAI base URL override", () => {
	it("omits config entirely when OPENAI_BASE_URL is unset (uses default api.openai.com)", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "gpt-4o" },
			{ OPENAI_API_KEY: "sk" },
		) as unknown as { __kind: string; config: unknown };
		expect(adapter.config).toBeUndefined();
		// Real OpenAI speaks the newer Responses API.
		expect(adapter.__kind).toBe("openai-mock");
	});

	it("passes a custom baseURL through (Azure / OpenRouter / Ollama / vLLM / corporate gateways)", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "gpt-4o" },
			{
				OPENAI_API_KEY: "sk",
				OPENAI_BASE_URL: "https://my-openrouter-proxy.example.com/v1",
			},
		) as unknown as { __kind: string; config: { baseURL: string } };
		expect(adapter.config).toEqual({
			baseURL: "https://my-openrouter-proxy.example.com/v1",
		});
		// Custom endpoints default to the broadly-supported Chat Completions API.
		expect(adapter.__kind).toBe("openai-chat-completions-mock");
	});

	it("trims surrounding whitespace on OPENAI_BASE_URL", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "gpt-4o" },
			{
				OPENAI_API_KEY: "sk",
				OPENAI_BASE_URL: "  https://idp.example.com/v1  ",
			},
		) as unknown as { config: { baseURL: string } };
		expect(adapter.config?.baseURL).toBe("https://idp.example.com/v1");
	});

	it("treats an empty / whitespace-only OPENAI_BASE_URL as 'use default'", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "gpt-4o" },
			{ OPENAI_API_KEY: "sk", OPENAI_BASE_URL: "   " },
		) as unknown as { __kind: string; config: unknown };
		expect(adapter.config).toBeUndefined();
		expect(adapter.__kind).toBe("openai-mock");
	});
});

describe("createTextAdapter — OpenAI API format (Responses vs Chat Completions)", () => {
	const gatewayEnv = {
		OPENAI_API_KEY: "gateway-token",
		OPENAI_BASE_URL: "https://llm-gateway.example.com/v1/",
	};

	it("uses the Chat Completions adapter when OPENAI_BASE_URL points at a custom endpoint", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "internal-model" },
			gatewayEnv,
		) as unknown as { __kind: string; model: string; config: unknown };
		expect(adapter.__kind).toBe("openai-chat-completions-mock");
		expect(adapter.model).toBe("internal-model");
		expect(adapter.config).toEqual({
			baseURL: "https://llm-gateway.example.com/v1/",
		});
	});

	it("uses the Responses adapter against api.openai.com (no base URL)", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "gpt-5-mini" },
			{ OPENAI_API_KEY: "sk" },
		) as unknown as { __kind: string };
		expect(adapter.__kind).toBe("openai-mock");
	});

	it("OPENAI_API_FORMAT=responses forces the Responses adapter even with a custom base URL", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "gpt-5-mini" },
			{ ...gatewayEnv, OPENAI_API_FORMAT: "responses" },
		) as unknown as { __kind: string };
		expect(adapter.__kind).toBe("openai-mock");
	});

	it("OPENAI_API_FORMAT=chat-completions forces Chat Completions against api.openai.com", () => {
		const adapter = createTextAdapter(
			{ provider: "openai", model: "gpt-5-mini" },
			{ OPENAI_API_KEY: "sk", OPENAI_API_FORMAT: "chat-completions" },
		) as unknown as { __kind: string };
		expect(adapter.__kind).toBe("openai-chat-completions-mock");
	});
});

describe("resolveOpenAiApiFormat", () => {
	it("defaults to responses without a base URL and chat-completions with one", () => {
		expect(resolveOpenAiApiFormat({})).toBe("responses");
		expect(
			resolveOpenAiApiFormat({ OPENAI_BASE_URL: "https://gw.example.com/v1" }),
		).toBe("chat-completions");
	});

	it("ignores a whitespace-only base URL", () => {
		expect(resolveOpenAiApiFormat({ OPENAI_BASE_URL: "   " })).toBe(
			"responses",
		);
	});

	it("accepts chat_completions / completions spellings and normalizes case", () => {
		expect(resolveOpenAiApiFormat({ OPENAI_API_FORMAT: "Responses" })).toBe(
			"responses",
		);
		expect(
			resolveOpenAiApiFormat({ OPENAI_API_FORMAT: "chat_completions" }),
		).toBe("chat-completions");
		expect(resolveOpenAiApiFormat({ OPENAI_API_FORMAT: " completions " })).toBe(
			"chat-completions",
		);
	});

	it("throws on an unknown OPENAI_API_FORMAT so typos surface", () => {
		expect(() =>
			resolveOpenAiApiFormat({ OPENAI_API_FORMAT: "websocket" }),
		).toThrow(/not one of responses\|chat-completions/);
	});
});

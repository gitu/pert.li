import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, resolveProvider } from "#/lib/ai/provider";

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

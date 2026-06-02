import type { JSONSchema, Tool } from "@tanstack/ai";
import { constToEnum } from "./gemini-compat";
import { rewriteSchema, rewriteToolSchemas } from "./schema-compat";

// OpenAI structured-output dialect rewrite.
//
// The `@tanstack/ai-openai` adapters mark every function tool `strict: true`
// and run its input schema through `makeStructuredOutputCompatible`
// (@tanstack/openai-base), which hard-throws on any schema-position `oneOf`:
//
//   "oneOf is not supported in OpenAI structured output schemas. …"
//
// Zod emits `oneOf` for every `z.discriminatedUnion(...)` — which is exactly
// what `propose_changes`' `operations` array uses — so the chat handler
// failed on every request as soon as the OpenAI provider was selected,
// before anything ever reached the network.
//
// OpenAI structured output DOES support `anyOf`, and for a discriminated
// union the two are semantically equivalent (the literal discriminator makes
// the variants mutually exclusive, so "exactly one matches" and "at least one
// matches" describe the same set of documents). We rewrite `oneOf` → `anyOf`
// before handing tools to the adapter.
//
// We additionally rewrite `const` → single-value `enum` (same transform the
// Gemini path uses). Real api.openai.com accepts `const`, but the OpenAI
// provider is also the gateway for arbitrary OpenAI-compatible backends via
// OPENAI_BASE_URL (vLLM, llama.cpp, LM Studio, Ollama, corporate gateways …),
// and several of those only understand `enum`. The rewrite is lossless, so
// we always apply it rather than guessing per backend.

/**
 * Rewrite a single schema node into OpenAI-structured-output-compatible form:
 * `oneOf` → `anyOf`, `const` → single-value `enum`.
 */
export function openAiNodeRewrite(node: JSONSchema): JSONSchema {
	constToEnum(node);
	// Zod never emits both on one node; if a hand-written schema does, leave
	// it alone — merging them would change its meaning.
	if (Array.isArray(node.oneOf) && !("anyOf" in node)) {
		node.anyOf = node.oneOf;
		delete node.oneOf;
	}
	return node;
}

/**
 * Recursively rewrite a JSON Schema into the dialect OpenAI structured
 * output (strict function calling) accepts.
 */
export function toOpenAiCompatibleSchema(schema: JSONSchema): JSONSchema {
	return rewriteSchema(schema, openAiNodeRewrite);
}

/**
 * Apply {@link toOpenAiCompatibleSchema} to every tool's input schema.
 * Tools without an input schema (or with a non-object placeholder) pass
 * through unchanged.
 */
export function toOpenAiCompatibleTools(tools: Array<Tool>): Array<Tool> {
	return rewriteToolSchemas(tools, openAiNodeRewrite);
}

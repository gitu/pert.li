import type { JSONSchema, Tool } from "@tanstack/ai";
import { rewriteSchema, rewriteToolSchemas } from "./schema-compat";

// Gemini's function-declaration schema dialect (the OpenAPI-flavored `Schema`
// proto behind `function_declarations[].parameters`) does not understand the
// JSON Schema `const` keyword — the API rejects the whole request with
// `Unknown name "const" … Cannot find field`. Zod emits `const` for every
// `z.literal(...)`, which our tool inputs use heavily: the `op` discriminators
// of `propose_changes`' edit-operation union are all literals.
//
// `enum: [value]` is semantically identical to `const: value` and Gemini
// supports `enum`, so before handing tools to the Gemini adapter we rewrite
// every schema-position `const` into a single-value `enum`. Other providers
// (Anthropic) accept `const` natively and are left untouched; the OpenAI
// path has its own dialect rewrite in openai-compat.ts.

/** Rewrite `const: X` into `enum: [X]` on a single schema node. */
export function constToEnum(node: JSONSchema): JSONSchema {
	if ("const" in node) {
		node.enum = [node.const];
		delete node.const;
	}
	return node;
}

/**
 * Recursively rewrite `const: X` into `enum: [X]` in a JSON Schema.
 */
export function toGeminiCompatibleSchema(schema: JSONSchema): JSONSchema {
	return rewriteSchema(schema, constToEnum);
}

/**
 * Apply {@link toGeminiCompatibleSchema} to every tool's input schema.
 * Tools without an input schema (or with a non-object placeholder) pass
 * through unchanged.
 */
export function toGeminiCompatibleTools(tools: Array<Tool>): Array<Tool> {
	return rewriteToolSchemas(tools, constToEnum);
}

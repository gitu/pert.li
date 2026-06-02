import type { JSONSchema, Tool } from "@tanstack/ai";

// Shared plumbing for provider-specific JSON Schema dialect rewrites.
//
// Each LLM provider accepts a slightly different subset of JSON Schema for
// tool inputs (Gemini rejects `const`, OpenAI structured output rejects
// `oneOf`, …). The provider compat modules (gemini-compat.ts,
// openai-compat.ts) each define a small per-node rewrite; this module owns
// the schema-aware recursion that applies it everywhere a sub-schema can
// appear.
//
// The walk is schema-aware: it only recurses through positions that hold
// sub-schemas (`properties` values, `items`, `oneOf`/`anyOf`/`allOf`
// variants, …). A property that happens to be *named* like a keyword (i.e. a
// key inside `properties` called `const` or `oneOf`) is not a keyword and is
// preserved as-is.

/** Rewrites one schema node in place. Receives (and may mutate) a shallow copy. */
export type SchemaNodeRewrite = (node: JSONSchema) => JSONSchema;

/**
 * Recursively apply a per-node rewrite to a JSON Schema.
 *
 * The rewrite runs on the current node first (so it can rename keywords like
 * `oneOf` → `anyOf`), then the walk recurses into every position of the
 * *rewritten* node that holds sub-schemas.
 */
export function rewriteSchema(
	schema: JSONSchema,
	rewriteNode: SchemaNodeRewrite,
): JSONSchema {
	const result = rewriteNode({ ...schema });

	// Positions whose value is a single sub-schema.
	for (const key of [
		"items",
		"not",
		"if",
		"then",
		"else",
		"propertyNames",
	] as const) {
		const value = result[key];
		if (Array.isArray(value)) {
			// Draft-07 style tuple `items`.
			result[key] = value.map((entry) => rewriteSchema(entry, rewriteNode));
		} else if (isSchemaObject(value)) {
			result[key] = rewriteSchema(value, rewriteNode);
		}
	}

	// Positions whose value is an array of sub-schemas.
	for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"] as const) {
		const value = result[key];
		if (Array.isArray(value)) {
			result[key] = value.map((entry) =>
				isSchemaObject(entry) ? rewriteSchema(entry, rewriteNode) : entry,
			);
		}
	}

	// Positions whose value is a map of name → sub-schema.
	for (const key of [
		"properties",
		"patternProperties",
		"$defs",
		"definitions",
	] as const) {
		const value = result[key];
		if (isSchemaObject(value)) {
			const mapped: Record<string, JSONSchema> = {};
			for (const [name, sub] of Object.entries(value)) {
				mapped[name] = isSchemaObject(sub)
					? rewriteSchema(sub, rewriteNode)
					: sub;
			}
			result[key] = mapped;
		}
	}

	// `additionalProperties` is either a boolean or a sub-schema.
	if (isSchemaObject(result.additionalProperties)) {
		result.additionalProperties = rewriteSchema(
			result.additionalProperties,
			rewriteNode,
		);
	}

	return result;
}

/**
 * Apply a schema rewrite to every tool's input schema. Tools without an
 * input schema (or with a non-object placeholder) pass through unchanged.
 */
export function rewriteToolSchemas(
	tools: Array<Tool>,
	rewriteNode: SchemaNodeRewrite,
): Array<Tool> {
	return tools.map((tool) => {
		const inputSchema = (tool as { inputSchema?: unknown }).inputSchema;
		if (!isSchemaObject(inputSchema)) return tool;
		return {
			...tool,
			inputSchema: rewriteSchema(inputSchema, rewriteNode),
		} as Tool;
	});
}

export function isSchemaObject(value: unknown): value is JSONSchema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

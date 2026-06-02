import type { JSONSchema, Tool } from "@tanstack/ai";

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
// (Anthropic, OpenAI) accept `const` natively and are left untouched.

/**
 * Recursively rewrite `const: X` into `enum: [X]` in a JSON Schema.
 *
 * The walk is schema-aware: it only recurses through positions that hold
 * sub-schemas (`properties` values, `items`, `oneOf`/`anyOf`/`allOf`
 * variants, …). A property that happens to be *named* `const` (i.e. a key
 * inside `properties`) is not a keyword and is preserved as-is.
 */
export function toGeminiCompatibleSchema(schema: JSONSchema): JSONSchema {
	const result: JSONSchema = { ...schema };

	if ("const" in result) {
		result.enum = [result.const];
		delete result.const;
	}

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
			result[key] = value.map(toGeminiCompatibleSchema);
		} else if (isSchemaObject(value)) {
			result[key] = toGeminiCompatibleSchema(value);
		}
	}

	// Positions whose value is an array of sub-schemas.
	for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"] as const) {
		const value = result[key];
		if (Array.isArray(value)) {
			result[key] = value.map((entry) =>
				isSchemaObject(entry) ? toGeminiCompatibleSchema(entry) : entry,
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
					? toGeminiCompatibleSchema(sub)
					: sub;
			}
			result[key] = mapped;
		}
	}

	// `additionalProperties` is either a boolean or a sub-schema.
	if (isSchemaObject(result.additionalProperties)) {
		result.additionalProperties = toGeminiCompatibleSchema(
			result.additionalProperties,
		);
	}

	return result;
}

/**
 * Apply {@link toGeminiCompatibleSchema} to every tool's input schema.
 * Tools without an input schema (or with a non-object placeholder) pass
 * through unchanged.
 */
export function toGeminiCompatibleTools(tools: Array<Tool>): Array<Tool> {
	return tools.map((tool) => {
		const inputSchema = (tool as { inputSchema?: unknown }).inputSchema;
		if (!isSchemaObject(inputSchema)) return tool;
		return {
			...tool,
			inputSchema: toGeminiCompatibleSchema(inputSchema),
		} as Tool;
	});
}

function isSchemaObject(value: unknown): value is JSONSchema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

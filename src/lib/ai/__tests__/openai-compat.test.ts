import type { JSONSchema, Tool } from "@tanstack/ai";
import {
	createOpenaiChat,
	createOpenaiChatCompletions,
} from "@tanstack/ai-openai";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	toOpenAiCompatibleSchema,
	toOpenAiCompatibleTools,
} from "#/lib/ai/openai-compat";
import { editOpSchema } from "#/lib/ai/operations";
import { CHAT_TOOL_DEFINITIONS } from "#/lib/ai/tools";

// Walk a JSON Schema and collect every schema-position `oneOf` / `const`
// keyword. Mirrors the recursion in toOpenAiCompatibleSchema so the
// assertion "nothing OpenAI rejects survives" checks exactly the positions
// @tanstack/openai-base's makeStructuredOutputCompatible would throw on.
function collectSchemaKeyword(
	schema: JSONSchema,
	keyword: "oneOf" | "const",
	path = "$",
): Array<string> {
	const found: Array<string> = [];
	if (keyword in schema) found.push(path);

	const single = ["items", "not", "if", "then", "else", "propertyNames"];
	for (const key of single) {
		const value = schema[key];
		if (Array.isArray(value)) {
			value.forEach((entry, i) => {
				found.push(
					...collectSchemaKeyword(entry, keyword, `${path}.${key}[${i}]`),
				);
			});
		} else if (isObject(value)) {
			found.push(...collectSchemaKeyword(value, keyword, `${path}.${key}`));
		}
	}
	const arrays = ["oneOf", "anyOf", "allOf", "prefixItems"];
	for (const key of arrays) {
		const value = schema[key];
		if (Array.isArray(value)) {
			value.forEach((entry, i) => {
				if (isObject(entry)) {
					found.push(
						...collectSchemaKeyword(entry, keyword, `${path}.${key}[${i}]`),
					);
				}
			});
		}
	}
	const maps = ["properties", "patternProperties", "$defs", "definitions"];
	for (const key of maps) {
		const value = schema[key];
		if (isObject(value)) {
			for (const [name, sub] of Object.entries(value)) {
				if (isObject(sub)) {
					found.push(
						...collectSchemaKeyword(sub, keyword, `${path}.${key}.${name}`),
					);
				}
			}
		}
	}
	if (isObject(schema.additionalProperties)) {
		found.push(
			...collectSchemaKeyword(
				schema.additionalProperties,
				keyword,
				`${path}.additionalProperties`,
			),
		);
	}
	return found;
}

function isObject(value: unknown): value is JSONSchema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Serialize the chat tool definitions the way the browser client does before
// sending them to the server: Zod standard-schema → draft-07 JSON Schema.
// This is exactly what `mergeAgentTools([], params.tools)` hands the provider
// compat layer in chat.server.ts.
function clientSerializedChatTools(): Array<Tool> {
	return CHAT_TOOL_DEFINITIONS.map((def) => {
		const standard = (
			def.inputSchema as unknown as {
				"~standard": {
					jsonSchema: { input: (opts: { target: string }) => JSONSchema };
				};
			}
		)["~standard"];
		return {
			name: def.name,
			description: def.description,
			inputSchema: standard.jsonSchema.input({ target: "draft-07" }),
		} as Tool;
	});
}

describe("toOpenAiCompatibleSchema — oneOf → anyOf rewriting", () => {
	it("rewrites a top-level oneOf into anyOf", () => {
		expect(
			toOpenAiCompatibleSchema({
				oneOf: [{ type: "string" }, { type: "number" }],
			}),
		).toEqual({
			anyOf: [{ type: "string" }, { type: "number" }],
		});
	});

	it("rewrites oneOf nested under array items (the propose_changes shape)", () => {
		const result = toOpenAiCompatibleSchema({
			type: "object",
			properties: {
				operations: {
					type: "array",
					items: {
						oneOf: [
							{
								type: "object",
								properties: { op: { type: "string", const: "add_task" } },
							},
							{
								type: "object",
								properties: { op: { type: "string", const: "remove_task" } },
							},
						],
					},
				},
			},
		});
		const items = result.properties?.operations?.items as JSONSchema;
		expect(items.oneOf).toBeUndefined();
		expect(items.anyOf).toHaveLength(2);
		// const discriminators also become single-value enums.
		expect(items.anyOf?.[0]?.properties?.op).toEqual({
			type: "string",
			enum: ["add_task"],
		});
		expect(collectSchemaKeyword(result, "oneOf")).toEqual([]);
		expect(collectSchemaKeyword(result, "const")).toEqual([]);
	});

	it("rewrites oneOf inside anyOf/allOf/$defs positions", () => {
		const result = toOpenAiCompatibleSchema({
			anyOf: [{ oneOf: [{ type: "string" }] }],
			allOf: [{ oneOf: [{ type: "number" }] }],
			$defs: { u: { oneOf: [{ type: "boolean" }] } },
		});
		expect(result.anyOf?.[0]).toEqual({ anyOf: [{ type: "string" }] });
		expect(result.allOf?.[0]).toEqual({ anyOf: [{ type: "number" }] });
		expect(result.$defs?.u).toEqual({ anyOf: [{ type: "boolean" }] });
	});

	it("does NOT touch a property that is merely *named* 'oneOf'", () => {
		const result = toOpenAiCompatibleSchema({
			type: "object",
			properties: {
				oneOf: { type: "string" },
			},
		});
		expect(result.properties).toEqual({ oneOf: { type: "string" } });
		expect(result.anyOf).toBeUndefined();
	});

	it("leaves a node alone when it carries both oneOf and anyOf (merging would change meaning)", () => {
		const input: JSONSchema = {
			oneOf: [{ type: "string" }],
			anyOf: [{ type: "number" }],
		};
		const result = toOpenAiCompatibleSchema(input);
		expect(result.oneOf).toEqual([{ type: "string" }]);
		expect(result.anyOf).toEqual([{ type: "number" }]);
	});

	it("preserves all other keywords (description, required, minItems, pattern, …)", () => {
		const input: JSONSchema = {
			type: "object",
			description: "a thing",
			properties: {
				name: { type: "string", minLength: 1, pattern: "^[a-z]+$" },
				count: { type: "number", minimum: 0 },
			},
			required: ["name"],
			additionalProperties: false,
		};
		expect(toOpenAiCompatibleSchema(input)).toEqual(input);
	});

	it("does not mutate its input", () => {
		const input: JSONSchema = {
			type: "object",
			properties: {
				operations: { items: { oneOf: [{ const: "a" }] }, type: "array" },
			},
		};
		const snapshot = structuredClone(input);
		toOpenAiCompatibleSchema(input);
		expect(input).toEqual(snapshot);
	});

	it("is idempotent", () => {
		const input: JSONSchema = {
			oneOf: [
				{ properties: { op: { const: "a" } } },
				{ properties: { op: { const: "b" } } },
			],
		};
		const once = toOpenAiCompatibleSchema(input);
		const twice = toOpenAiCompatibleSchema(once);
		expect(twice).toEqual(once);
	});
});

describe("toOpenAiCompatibleSchema — real propose_changes schema", () => {
	it("strips every oneOf and const from the editOpSchema-based operations schema", () => {
		const inputSchema = z.toJSONSchema(
			z.object({
				rationale: z.string().min(1),
				operations: z.array(editOpSchema).min(1),
			}),
		) as JSONSchema;

		// Sanity: the raw Zod output really does contain what OpenAI rejects.
		expect(collectSchemaKeyword(inputSchema, "oneOf").length).toBeGreaterThan(
			0,
		);
		expect(
			collectSchemaKeyword(inputSchema, "const").length,
		).toBeGreaterThanOrEqual(18);

		const result = toOpenAiCompatibleSchema(inputSchema);
		expect(collectSchemaKeyword(result, "oneOf")).toEqual([]);
		expect(collectSchemaKeyword(result, "const")).toEqual([]);
		expect(JSON.stringify(result)).not.toContain('"oneOf"');

		// Every discriminated-union variant survived, as anyOf entries with
		// single-value enum discriminators.
		const items = result.properties?.operations?.items as JSONSchema;
		const variants = items.anyOf as Array<JSONSchema>;
		expect(variants.length).toBeGreaterThanOrEqual(18);
		for (const variant of variants) {
			const op = variant.properties?.op as JSONSchema;
			expect(op.enum).toHaveLength(1);
			expect(typeof op.enum?.[0]).toBe("string");
		}
	});
});

describe("toOpenAiCompatibleTools — against the real @tanstack/ai-openai adapters", () => {
	// These tests exercise the exact code path that 500'd in production:
	// the OpenAI adapters mark every tool `strict: true` and run its input
	// schema through makeStructuredOutputCompatible, which throws on `oneOf`.
	// `mapOptionsToRequest` is a protected method — reach in via bracket
	// access. If an adapter upgrade renames it, these tests fail loudly and
	// the compat layer needs re-verification anyway.
	type RequestMapper = {
		mapOptionsToRequest: (options: unknown) => { tools?: Array<unknown> };
	};

	const buildOptions = (tools: Array<Tool>) => ({
		model: "gpt-5-mini",
		messages: [
			{ role: "user", content: [{ type: "text", content: "break this down" }] },
		],
		tools,
		systemPrompts: [],
	});

	const adapters = [
		{
			label: "Responses API (createOpenaiChat)",
			make: () =>
				createOpenaiChat("gpt-5-mini", "sk-test") as unknown as RequestMapper,
			// The Responses adapter marks every tool `strict: true` and runs its
			// input schema through makeStructuredOutputCompatible, which hard-throws
			// on `oneOf`.
			rawToolsThrow: true,
		},
		{
			label: "Chat Completions API (createOpenaiChatCompletions)",
			make: () =>
				createOpenaiChatCompletions(
					"gpt-5-mini",
					"sk-test",
				) as unknown as RequestMapper,
			// Since @tanstack/ai-openai 0.15 the Chat Completions adapter no longer
			// rejects `oneOf` — it passes the schema through verbatim, so the raw
			// discriminated-union `oneOf` leaks straight into the outgoing request.
			// That is exactly what the compat layer strips before it reaches OpenAI.
			rawToolsThrow: false,
		},
	];

	for (const { label, make, rawToolsThrow } of adapters) {
		it(`${label} ${rawToolsThrow ? "rejects" : "leaks oneOf from"} the raw chat tools (documents why the compat layer exists)`, () => {
			const rawTools = clientSerializedChatTools();
			if (rawToolsThrow) {
				expect(() =>
					make().mapOptionsToRequest(buildOptions(rawTools)),
				).toThrow(/oneOf is not supported/);
				return;
			}
			// No throw, but the discriminated-union `oneOf` survives untouched —
			// OpenAI's strict structured outputs would reject it, so the compat
			// layer is still required.
			const request = make().mapOptionsToRequest(buildOptions(rawTools));
			expect(JSON.stringify(request.tools)).toContain('"oneOf"');
		});

		it(`${label} builds a request from the compat-rewritten chat tools`, () => {
			const tools = toOpenAiCompatibleTools(clientSerializedChatTools());
			const request = make().mapOptionsToRequest(buildOptions(tools));
			// Every chat tool made it into the outgoing request.
			expect(request.tools).toHaveLength(CHAT_TOOL_DEFINITIONS.length);
			// And nothing OpenAI structured output rejects is left anywhere.
			expect(JSON.stringify(request.tools)).not.toContain('"oneOf"');
		});
	}
});

describe("toOpenAiCompatibleTools", () => {
	it("rewrites inputSchema on every tool and leaves other fields alone", () => {
		const tools = [
			{
				name: "propose_changes",
				description: "stage a batch",
				inputSchema: {
					type: "object",
					properties: {
						operations: {
							type: "array",
							items: { oneOf: [{ type: "object" }] },
						},
					},
				},
			},
			{
				name: "read_project",
				description: "read",
				inputSchema: { type: "object", properties: {} },
			},
		] as Array<Tool>;

		const result = toOpenAiCompatibleTools(tools);
		const schema = (result[0] as { inputSchema: JSONSchema }).inputSchema;
		expect((schema.properties?.operations as JSONSchema).items).toEqual({
			anyOf: [{ type: "object" }],
		});
		expect(result[0]?.name).toBe("propose_changes");
		expect(result[0]?.description).toBe("stage a batch");
		// Tool without unions is structurally unchanged.
		expect(result[1]).toEqual(tools[1]);
	});

	it("passes through tools without an input schema", () => {
		const tool = { name: "bare", description: "no schema" } as Tool;
		expect(toOpenAiCompatibleTools([tool])[0]).toBe(tool);
	});
});

describe("toOpenAiCompatibleSchema — properties", () => {
	const literalArb = fc.oneof(
		fc.string(),
		fc.integer(),
		fc.boolean(),
		fc.constant(null),
	);

	it("no schema-position oneOf or const survives in a generated discriminated-union schema", () => {
		// Generate object schemas shaped like Zod discriminated unions:
		// array items → oneOf variants → properties with const discriminators.
		const variantArb = fc
			.tuple(
				fc.string({ minLength: 1 }),
				fc.dictionary(fc.string(), literalArb),
			)
			.map(([disc, extras]) => ({
				type: "object",
				properties: {
					op: { type: "string", const: disc },
					...Object.fromEntries(
						Object.keys(extras).map((k) => [k, { type: "string" }]),
					),
				},
				required: ["op"],
			}));
		const schemaArb = fc
			.array(variantArb, { minLength: 1, maxLength: 20 })
			.map((variants) => ({
				type: "object",
				properties: {
					operations: { type: "array", items: { oneOf: variants } },
				},
			}));

		fc.assert(
			fc.property(schemaArb, (schema) => {
				const result = toOpenAiCompatibleSchema(schema as JSONSchema);
				expect(collectSchemaKeyword(result, "oneOf")).toEqual([]);
				expect(collectSchemaKeyword(result, "const")).toEqual([]);
				// Variant count is preserved 1:1 in the anyOf.
				const items = (result.properties?.operations as JSONSchema)
					.items as JSONSchema;
				expect(items.anyOf).toHaveLength(
					(schema.properties.operations.items.oneOf as Array<unknown>).length,
				);
			}),
		);
	});

	it("rewriting twice equals rewriting once (idempotence over generated schemas)", () => {
		const nodeArb = fc.letrec((tie) => ({
			schema: fc.oneof(
				{ maxDepth: 3, withCrossShrink: true },
				fc.record({ type: fc.constant("string") }),
				fc.record({ const: literalArb }),
				fc
					.array(tie("schema") as fc.Arbitrary<JSONSchema>, {
						minLength: 1,
						maxLength: 3,
					})
					.map((variants) => ({ oneOf: variants })),
				fc
					.tuple(fc.string({ minLength: 1 }), tie("schema"))
					.map(([key, sub]) => ({
						type: "object",
						properties: { [key]: sub },
					})),
			),
		})).schema;

		fc.assert(
			fc.property(nodeArb, (schema) => {
				const once = toOpenAiCompatibleSchema(schema as JSONSchema);
				const twice = toOpenAiCompatibleSchema(once);
				expect(twice).toEqual(once);
			}),
		);
	});
});

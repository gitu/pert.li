import type { JSONSchema, Tool } from "@tanstack/ai";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	toGeminiCompatibleSchema,
	toGeminiCompatibleTools,
} from "#/lib/ai/gemini-compat";
import { editOpSchema } from "#/lib/ai/operations";

// Walk a JSON Schema and collect every schema-position `const` keyword.
// Mirrors the recursion in toGeminiCompatibleSchema so the assertion
// "no const survives" checks exactly the positions Gemini would reject.
function collectSchemaConsts(schema: JSONSchema, path = "$"): Array<string> {
	const found: Array<string> = [];
	if ("const" in schema) found.push(path);

	const single = ["items", "not", "if", "then", "else", "propertyNames"];
	for (const key of single) {
		const value = schema[key];
		if (Array.isArray(value)) {
			value.forEach((entry, i) => {
				found.push(...collectSchemaConsts(entry, `${path}.${key}[${i}]`));
			});
		} else if (isObject(value)) {
			found.push(...collectSchemaConsts(value, `${path}.${key}`));
		}
	}
	const arrays = ["oneOf", "anyOf", "allOf", "prefixItems"];
	for (const key of arrays) {
		const value = schema[key];
		if (Array.isArray(value)) {
			value.forEach((entry, i) => {
				if (isObject(entry)) {
					found.push(...collectSchemaConsts(entry, `${path}.${key}[${i}]`));
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
					found.push(...collectSchemaConsts(sub, `${path}.${key}.${name}`));
				}
			}
		}
	}
	if (isObject(schema.additionalProperties)) {
		found.push(
			...collectSchemaConsts(
				schema.additionalProperties,
				`${path}.additionalProperties`,
			),
		);
	}
	return found;
}

function isObject(value: unknown): value is JSONSchema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("toGeminiCompatibleSchema — const → enum rewriting", () => {
	it("rewrites a top-level const into a single-value enum", () => {
		expect(
			toGeminiCompatibleSchema({ type: "string", const: "add_task" }),
		).toEqual({
			type: "string",
			enum: ["add_task"],
		});
	});

	it("rewrites consts nested in properties", () => {
		const result = toGeminiCompatibleSchema({
			type: "object",
			properties: {
				op: { type: "string", const: "set_title" },
				title: { type: "string" },
			},
			required: ["op", "title"],
		});
		expect(result.properties?.op).toEqual({
			type: "string",
			enum: ["set_title"],
		});
		// Sibling property untouched.
		expect(result.properties?.title).toEqual({ type: "string" });
	});

	it("rewrites consts inside oneOf variants under array items (the propose_changes shape)", () => {
		// This is the exact structure Gemini 400'd on:
		// operations: array → items → oneOf[N] → properties.op → const
		const result = toGeminiCompatibleSchema({
			type: "object",
			properties: {
				rationale: { type: "string" },
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
		expect(items.oneOf?.[0]?.properties?.op).toEqual({
			type: "string",
			enum: ["add_task"],
		});
		expect(items.oneOf?.[1]?.properties?.op).toEqual({
			type: "string",
			enum: ["remove_task"],
		});
		expect(collectSchemaConsts(result)).toEqual([]);
	});

	it("rewrites consts in anyOf, allOf, $defs, and additionalProperties positions", () => {
		const result = toGeminiCompatibleSchema({
			anyOf: [{ const: 1 }],
			allOf: [{ const: true }],
			$defs: { lit: { const: "x" } },
			additionalProperties: { const: null },
		});
		expect(result.anyOf?.[0]).toEqual({ enum: [1] });
		expect(result.allOf?.[0]).toEqual({ enum: [true] });
		expect(result.$defs?.lit).toEqual({ enum: ["x"] });
		expect(result.additionalProperties).toEqual({ enum: [null] });
	});

	it("does NOT touch a property that is merely *named* 'const'", () => {
		const result = toGeminiCompatibleSchema({
			type: "object",
			properties: {
				const: { type: "string" },
			},
		});
		expect(result.properties).toEqual({ const: { type: "string" } });
		expect(result.properties?.enum).toBeUndefined();
	});

	it("preserves all non-const keywords (description, required, minItems, pattern, …)", () => {
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
		expect(toGeminiCompatibleSchema(input)).toEqual(input);
	});

	it("does not mutate its input", () => {
		const input: JSONSchema = {
			type: "object",
			properties: { op: { type: "string", const: "add_task" } },
		};
		const snapshot = structuredClone(input);
		toGeminiCompatibleSchema(input);
		expect(input).toEqual(snapshot);
	});

	it("is idempotent", () => {
		const input: JSONSchema = {
			oneOf: [
				{ properties: { op: { const: "a" } } },
				{ properties: { op: { const: "b" } } },
			],
		};
		const once = toGeminiCompatibleSchema(input);
		const twice = toGeminiCompatibleSchema(once);
		expect(twice).toEqual(once);
	});
});

describe("toGeminiCompatibleSchema — real propose_changes schema", () => {
	it("strips every const from the editOpSchema-based operations schema", () => {
		// Build the same input schema propose_changes declares, converted to
		// JSON Schema the way the chat client serializes Zod tools.
		const inputSchema = z.toJSONSchema(
			z.object({
				rationale: z.string().min(1),
				operations: z.array(editOpSchema).min(1),
			}),
		) as JSONSchema;

		// Sanity: the raw Zod output really does contain the consts Gemini
		// rejects (one per discriminated-union variant).
		const before = collectSchemaConsts(inputSchema);
		expect(before.length).toBeGreaterThanOrEqual(18);

		const result = toGeminiCompatibleSchema(inputSchema);
		expect(collectSchemaConsts(result)).toEqual([]);
		// And the serialized payload contains no `"const"` keyword at all.
		expect(JSON.stringify(result)).not.toContain('"const"');

		// Each op discriminator survived as a single-value enum.
		const items = result.properties?.operations?.items as JSONSchema;
		const variants = (items.oneOf ?? items.anyOf) as Array<JSONSchema>;
		expect(variants.length).toBeGreaterThanOrEqual(18);
		for (const variant of variants) {
			const op = variant.properties?.op as JSONSchema;
			expect(op.enum).toHaveLength(1);
			expect(typeof op.enum?.[0]).toBe("string");
		}
	});
});

describe("toGeminiCompatibleTools", () => {
	it("rewrites inputSchema on every tool and leaves other fields alone", () => {
		const tools = [
			{
				name: "propose_changes",
				description: "stage a batch",
				inputSchema: {
					type: "object",
					properties: { op: { type: "string", const: "add_task" } },
				},
			},
			{
				name: "read_project",
				description: "read",
				inputSchema: { type: "object", properties: {} },
			},
		] as Array<Tool>;

		const result = toGeminiCompatibleTools(tools);
		expect(
			(result[0] as { inputSchema: JSONSchema }).inputSchema.properties?.op,
		).toEqual({ type: "string", enum: ["add_task"] });
		expect(result[0]?.name).toBe("propose_changes");
		expect(result[0]?.description).toBe("stage a batch");
		// Tool without consts is structurally unchanged.
		expect(result[1]).toEqual(tools[1]);
	});

	it("passes through tools without an input schema", () => {
		const tool = { name: "bare", description: "no schema" } as Tool;
		expect(toGeminiCompatibleTools([tool])[0]).toBe(tool);
	});
});

describe("toGeminiCompatibleSchema — properties", () => {
	// Arbitrary JSON-serializable literal values for `const`.
	const literalArb = fc.oneof(
		fc.string(),
		fc.integer(),
		fc.boolean(),
		fc.constant(null),
	);

	it("any const value becomes a single-entry enum holding that value", () => {
		fc.assert(
			fc.property(literalArb, (value) => {
				const result = toGeminiCompatibleSchema({ const: value });
				expect(result).toEqual({ enum: [value] });
			}),
		);
	});

	it("no schema-position const survives in a generated discriminated-union schema", () => {
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
					// Extra non-discriminator props. Exclude "op" so a generated
					// extras key can't clobber the const discriminator with a
					// plain { type: "string" } (which has no const to convert).
					...Object.fromEntries(
						Object.keys(extras)
							.filter((k) => k !== "op")
							.map((k) => [k, { type: "string" }]),
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
				const result = toGeminiCompatibleSchema(schema as JSONSchema);
				expect(collectSchemaConsts(result)).toEqual([]);
				// Round-trip count: every const became an enum of length 1.
				const items = result.properties?.operations?.items as JSONSchema;
				for (const variant of items.oneOf ?? []) {
					expect((variant.properties?.op as JSONSchema).enum).toHaveLength(1);
				}
			}),
		);
	});
});

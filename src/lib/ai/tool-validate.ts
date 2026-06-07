// Client-side tool input validation — the guard the @tanstack/ai client runtime
// doesn't provide.
//
// `toolDefinition(...).client(execute)` spreads the tool config (including its
// Zod `inputSchema`) onto the client tool but, unlike the server path, never
// validates the model's arguments against that schema before calling `execute`.
// So a malformed tool call reaches the handler — and the mutators — as raw,
// unchecked JSON. The worst case is an absent required field surfacing as an
// explicit `undefined`, which is legal on a plain-JS object but throws
// Automerge's "Cannot assign undefined value" RangeError when it lands on the
// live document.
//
// `withInputValidation` closes that gap uniformly: it safe-parses the args
// against the tool's own `inputSchema` and short-circuits with a structured
// failure the model can react to, instead of letting bad input crash the run.
// On success it forwards the PARSED data (unknown keys stripped) so nothing
// stray slips through.

import type { ZodType } from "zod";

// The shape we need from @tanstack/ai's client tool: a name, the optional
// executor, and the Zod input schema spread from the tool definition. Kept
// structural so this module doesn't depend on the library's internal types.
type ValidatableTool = {
	name: string;
	// biome-ignore lint/suspicious/noExplicitAny: tool args/results are heterogeneous by design; the wrapper is transparent to them.
	execute?: (args: any) => any;
	// biome-ignore lint/suspicious/noExplicitAny: schemas vary per tool; only safeParse is used.
	inputSchema?: ZodType<any>;
};

export function withInputValidation<T extends ValidatableTool>(tool: T): T {
	const original = tool.execute;
	const schema = tool.inputSchema;
	// Tools without an executor or schema pass through untouched.
	if (!original || typeof schema?.safeParse !== "function") return tool;
	const wrapped = async (args: unknown) => {
		const parsed = schema.safeParse(args);
		if (!parsed.success) {
			const reason = parsed.error.issues
				.map((iss) => {
					const path = iss.path.join(".");
					return path ? `${path}: ${iss.message}` : iss.message;
				})
				.join("; ");
			return {
				ok: false as const,
				error: `Invalid arguments for ${tool.name}: ${reason}`,
			};
		}
		return original(parsed.data);
	};
	return { ...tool, execute: wrapped };
}

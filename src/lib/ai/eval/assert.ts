import type { z } from "zod";
import { CHAT_TOOL_DEFINITIONS } from "../tools";
import type { ToolCall } from "./build-server-tools";
import { recordScenario } from "./report";
import type { ScenarioRun } from "./runner";

// Assertion + stability helpers for the eval scenarios. Predicate helpers
// return booleans (no throw) so a single attempt can compute pass/fail, and
// `repeat` runs an attempt N times and enforces a pass ratio — the harness's
// answer to LLM non-determinism.

// ── Tool-call inspection ────────────────────────────────────────────────────

export function toolCallsNamed(run: ScenarioRun, name: string): ToolCall[] {
	return run.toolCalls.filter((c) => c.name === name);
}

export function calledTool(run: ScenarioRun, name: string): boolean {
	return run.toolCalls.some((c) => c.name === name);
}

/** First call of `name` whose args satisfy `predicate` (or any call if omitted). */
export function toolCallMatching(
	run: ScenarioRun,
	name: string,
	predicate?: (args: Record<string, unknown>, call: ToolCall) => boolean,
): ToolCall | undefined {
	return run.toolCalls.find(
		(c) =>
			c.name === name &&
			(!predicate || predicate((c.args ?? {}) as Record<string, unknown>, c)),
	);
}

// Tools that mutate project state — used by tutorial/refusal scenarios that
// expect the model to ANSWER rather than act.
const MUTATING_TOOLS = new Set<string>(
	CHAT_TOOL_DEFINITIONS.map((d) => d.name).filter(
		(n) => n !== "read_project" && n !== "get_work_plan" && n !== "ask_choice",
	),
);

export function mutatingToolCalls(run: ScenarioRun): ToolCall[] {
	return run.toolCalls.filter((c) => MUTATING_TOOLS.has(c.name));
}

// ── Schema / refusal guards ─────────────────────────────────────────────────

const SCHEMA_BY_NAME = new Map<string, z.ZodType>(
	CHAT_TOOL_DEFINITIONS.map((d) => [d.name, d.inputSchema as z.ZodType]),
);

// Recursively drop object keys whose value is explicit `null`. Models routinely
// send `null` for an optional field they don't want to set — at the top level
// AND nested (e.g. inside `propose_changes.operations[*]`: `id: null`,
// `label: null`, `estimate: null`). The live tools treat those as "not
// provided" (mutators use `args.x ?? default`, and the server doesn't
// Zod-validate tool args at all — it ferries them to the client), so a null on
// an `.optional()` field is benign, not malformed. Array elements are recursed
// into but a `null` element is kept (a null op IS malformed and should flag).
function stripNullsDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripNullsDeep);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (v === null) continue;
			out[k] = stripNullsDeep(v);
		}
		return out;
	}
	return value;
}

/**
 * Re-validate every recorded tool call's args against the tool's original Zod
 * input schema. Catches the model emitting structurally-invalid arguments that
 * would break the live mutators. Mirrors the runtime's null tolerance: a call
 * that only fails because the model nulled an optional field (which the live
 * tools treat as "unset") is NOT flagged — genuinely-nullable fields already
 * pass on the first parse, so this never masks a real malformation.
 */
export function validateAllToolArgs(run: ScenarioRun): {
	ok: boolean;
	errors: string[];
} {
	const errors: string[] = [];
	for (const call of run.toolCalls) {
		const schema = SCHEMA_BY_NAME.get(call.name);
		if (!schema) {
			errors.push(`called unknown tool "${call.name}"`);
			continue;
		}
		const parsed = schema.safeParse(call.args);
		if (parsed.success) continue;
		// Retry with explicit nulls stripped (recursively): if it now passes,
		// the only problem was null-on-optional, which the runtime tolerates.
		if (schema.safeParse(stripNullsDeep(call.args)).success) continue;
		const detail = parsed.error.issues
			.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("; ");
		errors.push(`${call.name}: ${detail}`);
	}
	return { ok: errors.length === 0, errors };
}

/**
 * Throw (failing the current repeat() run) with the specific Zod issues when
 * any recorded tool call has invalid args — so the eval report shows the exact
 * tool/field mismatch instead of a generic "assertion not met".
 */
export function assertValidArgs(run: ScenarioRun): void {
	const { ok, errors } = validateAllToolArgs(run);
	if (!ok) {
		throw new Error(`invalid tool args: ${errors.join(" | ")}`);
	}
}

// Matches the SYSTEM_PROMPT refusal template ("Sorry — I only help with PERT
// and project planning inside pert.li."). Anchored on the template's distinctive
// core *including the product name* — an in-scope answer that mentions scope
// ("I only help with PERT planning, so here's…") won't say "inside pert.li",
// and the prompt instructs the model to use the template verbatim, so requiring
// it also measures template fidelity. Tolerant of the "Sorry —" prefix and
// inter-word whitespace; the trailing "." before pert.li is escaped.
export function looksRefused(text: string): boolean {
	return /only help with pert and project planning\s+inside\s+pert\.li/i.test(
		text,
	);
}

export function expectNoRefusal(run: ScenarioRun): boolean {
	return !looksRefused(run.finalText);
}

// ── Repeat + threshold ──────────────────────────────────────────────────────

export type EvalConfig = { repeats: number; threshold: number };

/** Defaults (5 runs, 80% pass), overridable via EVAL_REPEATS / EVAL_THRESHOLD. */
export function evalConfig(): EvalConfig {
	const repeats = Number.parseInt(process.env.EVAL_REPEATS ?? "", 10);
	const threshold = Number.parseFloat(process.env.EVAL_THRESHOLD ?? "");
	return {
		repeats: Number.isFinite(repeats) && repeats > 0 ? repeats : 5,
		threshold:
			Number.isFinite(threshold) && threshold > 0 && threshold <= 1
				? threshold
				: 0.8,
	};
}

export type Attempt = () => boolean | Promise<boolean>;

export type RepeatOptions = Partial<EvalConfig> & {
	// "objective" (default): pass/fail is fully deterministic (tool calls, doc
	// state, schema/refusal). "judge": pass/fail depended on the LLM judge.
	// Recorded so the report can score the two dimensions separately.
	kind?: "objective" | "judge";
};

/**
 * Run `attempt` `repeats` times; throw (failing the vitest test) unless the
 * pass ratio meets `threshold`. A thrown attempt counts as a failed run, with
 * its message captured in the final report so flakiness is diagnosable. The
 * per-scenario pass ratio is recorded to the score sink (report.ts) on every
 * run — pass or fail — so the summary can compute an aggregate score.
 */
export async function repeat(
	label: string,
	attempt: Attempt,
	options: RepeatOptions = {},
): Promise<void> {
	const defaults = evalConfig();
	const repeats = options.repeats ?? defaults.repeats;
	const threshold = options.threshold ?? defaults.threshold;
	const kind = options.kind ?? "objective";
	let passes = 0;
	const failures: string[] = [];
	for (let i = 0; i < repeats; i++) {
		try {
			if (await attempt()) {
				passes++;
			} else {
				failures.push(`run #${i + 1}: assertion not met`);
			}
		} catch (err) {
			failures.push(
				`run #${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	const ratio = passes / repeats;
	recordScenario({ scenario: label, kind, passes, repeats, ratio });
	if (ratio < threshold) {
		throw new Error(
			`${label}: passed ${passes}/${repeats} (${ratio.toFixed(2)} < ${threshold} threshold)\n  ${failures.join("\n  ")}`,
		);
	}
}

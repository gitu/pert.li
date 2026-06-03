// Client-side tool execution log — the browser half of "why did tool usage
// fail?".
//
// Every chat tool handler is wrapped with `withToolLogging`, which:
//   • records the call (args, result, duration, error) into an in-memory ring
//     buffer, inspectable from devtools via `window.__pertliToolLog.entries()`,
//   • mirrors each call to the devtools console (`console.debug`; errors and
//     ok:false results use `console.warn` so they stand out),
//   • converts handler exceptions into `{ ok: false, error }` results instead
//     of letting them escape — an uncaught throw inside a tool handler kills
//     the whole useChat run, which reads as "the chat just died" with no
//     trace of which tool was responsible.

export type ToolLogEntry = {
	at: string;
	tool: string;
	args: unknown;
	result?: unknown;
	error?: string;
	durationMs: number;
	ok: boolean;
};

const MAX_ENTRIES = 200;

const buffer: ToolLogEntry[] = [];

export function getToolLog(): readonly ToolLogEntry[] {
	return buffer;
}

export function clearToolLog(): void {
	buffer.length = 0;
}

function record(entry: ToolLogEntry): void {
	buffer.push(entry);
	if (buffer.length > MAX_ENTRIES) buffer.shift();
	if (entry.ok) {
		console.debug(
			`[chat-tool] ${entry.tool} ok in ${entry.durationMs.toFixed(0)}ms`,
			{ args: entry.args, result: entry.result },
		);
	} else {
		console.warn(
			`[chat-tool] ${entry.tool} FAILED in ${entry.durationMs.toFixed(0)}ms: ${entry.error}`,
			{ args: entry.args, result: entry.result },
		);
	}
}

// Results follow the tools' own convention: anything with `ok: false` is a
// failure the model is meant to see and react to.
function isFailureResult(result: unknown): boolean {
	return (
		typeof result === "object" &&
		result !== null &&
		(result as { ok?: unknown }).ok === false
	);
}

function errorOf(result: unknown): string | undefined {
	if (typeof result !== "object" || result === null) return undefined;
	const err = (result as { error?: unknown }).error;
	return typeof err === "string" ? err : undefined;
}

// The shape we need from @tanstack/ai's ClientTool: a name and an optional
// execute function. Kept structural so this module doesn't import the
// library's types (and stays trivially unit-testable).
type ClientToolLike = {
	name: string;
	// biome-ignore lint/suspicious/noExplicitAny: tool args/results are heterogeneous by design; the wrapper is transparent to them.
	execute?: (args: any) => any;
};

// Wraps one tool's executor. Tools without an executor pass through.
export function withToolLogging<T extends ClientToolLike>(tool: T): T {
	const original = tool.execute;
	if (!original) return tool;
	const wrapped = async (args: unknown) => {
		const startedAt = performance.now();
		try {
			const result = await original(args);
			record({
				at: new Date().toISOString(),
				tool: tool.name,
				args,
				result,
				error: errorOf(result),
				durationMs: performance.now() - startedAt,
				ok: !isFailureResult(result),
			});
			return result;
		} catch (err) {
			const message =
				err instanceof Error ? err.message : `non-Error thrown: ${String(err)}`;
			record({
				at: new Date().toISOString(),
				tool: tool.name,
				args,
				error: message,
				durationMs: performance.now() - startedAt,
				ok: false,
			});
			// Contain the throw: the model gets a structured failure it can react
			// to instead of the whole run dying.
			return { ok: false as const, error: `${tool.name} crashed: ${message}` };
		}
	};
	return { ...tool, execute: wrapped };
}

// Expose the buffer for ad-hoc inspection from the devtools console.
declare global {
	interface Window {
		__pertliToolLog?: {
			entries: () => readonly ToolLogEntry[];
			clear: () => void;
		};
	}
}

if (typeof window !== "undefined") {
	window.__pertliToolLog = {
		entries: getToolLog,
		clear: clearToolLog,
	};
}

import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { StreamChunk } from "@tanstack/ai";

// Structured tracing for the chat handler — the server-side half of "why did
// tool usage fail?".
//
// Sinks:
//   • console — one summary line per request, plus every error. Always on.
//   • JSON-lines file — every request and every interesting stream event
//     (tool calls, tool results, run errors). On in dev (defaults to
//     .data/chat-debug.log) and whenever CHAT_DEBUG_FILE is set explicitly.
//     Off in production unless CHAT_DEBUG_FILE points somewhere.
//
// The file sink exists because the chat UI only shows its own rendering of
// the stream; when an OpenAI-compatible gateway rejects a tool schema or a
// model emits malformed tool-call args, the raw evidence is only visible
// server-side — and usually after the fact.

const isDev = process.env.NODE_ENV !== "production";

// Keep the dev log from growing without bound: truncate when it passes 5 MB.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function resolveLogFile(): string | null {
	const explicit = process.env.CHAT_DEBUG_FILE;
	if (explicit && explicit.trim().length > 0) return explicit.trim();
	if (isDev) return resolve(process.cwd(), ".data/chat-debug.log");
	return null;
}

let writeFailureWarned = false;

function writeLine(entry: Record<string, unknown>): void {
	const file = resolveLogFile();
	if (!file) return;
	try {
		mkdirSync(dirname(file), { recursive: true });
		try {
			if (statSync(file).size > MAX_LOG_BYTES) truncateSync(file, 0);
		} catch {
			// File doesn't exist yet — fine.
		}
		appendFileSync(
			file,
			`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
		);
	} catch (err) {
		if (!writeFailureWarned) {
			writeFailureWarned = true;
			console.warn("[chat] debug log not writable:", err);
		}
	}
}

export type ChatRequestInfo = {
	provider: string;
	model: string;
	threadId: string;
	runId: string;
	messageCount: number;
	toolNames: string[];
};

export function traceChatRequest(info: ChatRequestInfo): void {
	console.log(
		`[chat] ${info.provider}/${info.model} run=${info.runId} — ${info.messageCount} messages, ${info.toolNames.length} tools`,
	);
	writeLine({ kind: "request", ...info });
}

// Truncate big payloads (tool args can carry whole documents) so the log
// stays scannable; the leading slice is what matters for diagnosis.
// Exported for tests.
export function clip(value: unknown, max = 2000): string {
	let s: string | undefined;
	if (typeof value === "string") {
		s = value;
	} else {
		// Raw gateway events can contain circular references or BigInts —
		// JSON.stringify throws on both, and a throw here would take down the
		// chat response (this runs inside the stream wrapper), not just the log.
		try {
			s = JSON.stringify(value);
		} catch {
			s = String(value);
		}
	}
	if (s === undefined) return "";
	return s.length > max ? `${s.slice(0, max)}…[+${s.length - max} chars]` : s;
}

type AnyEvent = StreamChunk & {
	toolCallId?: string;
	toolCallName?: string;
	delta?: string;
	content?: unknown;
	message?: string;
	error?: unknown;
	rawEvent?: unknown;
};

// Wraps the chat stream, mirroring tool-call and error events into the trace
// sinks as they pass through. Chunks are yielded unchanged, so this is
// transparent to the SSE layer.
export async function* traceChatStream(
	stream: AsyncIterable<StreamChunk>,
	run: { runId: string; provider: string; model: string },
): AsyncIterable<StreamChunk> {
	// Tool-call args stream in deltas; accumulate them so the log shows the
	// complete arguments the model produced.
	const argBuffers = new Map<string, { name: string; args: string }>();
	try {
		for await (const chunk of stream) {
			const event = chunk as AnyEvent;
			switch (event.type) {
				case "TOOL_CALL_START": {
					const id = String(event.toolCallId ?? "");
					argBuffers.set(id, {
						name: String(event.toolCallName ?? "unknown"),
						args: "",
					});
					break;
				}
				case "TOOL_CALL_ARGS": {
					const id = String(event.toolCallId ?? "");
					const buf = argBuffers.get(id);
					if (buf) buf.args += String(event.delta ?? "");
					break;
				}
				case "TOOL_CALL_END": {
					const id = String(event.toolCallId ?? "");
					const buf = argBuffers.get(id);
					writeLine({
						kind: "tool-call",
						runId: run.runId,
						toolCallId: id,
						tool: buf?.name ?? "unknown",
						args: clip(buf?.args ?? ""),
					});
					break;
				}
				case "TOOL_CALL_RESULT": {
					const id = String(event.toolCallId ?? "");
					const buf = argBuffers.get(id);
					writeLine({
						kind: "tool-result",
						runId: run.runId,
						toolCallId: id,
						tool: buf?.name ?? "unknown",
						result: clip(event.content),
					});
					// The result is the last event for this call — free its buffer so
					// long work-plan runs (dozens of tool calls per turn) don't
					// accumulate every argument payload for the stream's lifetime.
					argBuffers.delete(id);
					break;
				}
				case "RUN_ERROR": {
					const message = String(event.message ?? event.error ?? "unknown");
					console.error(
						`[chat] RUN_ERROR (${run.provider}/${run.model}, run=${run.runId}): ${message}`,
					);
					writeLine({
						kind: "run-error",
						runId: run.runId,
						message,
						raw: clip(event.rawEvent ?? event, 4000),
					});
					break;
				}
				case "RUN_FINISHED": {
					writeLine({ kind: "run-finished", runId: run.runId });
					break;
				}
				default:
					break;
			}
			yield chunk;
		}
	} catch (err) {
		// Errors THROWN by the adapter (as opposed to emitted RUN_ERROR events):
		// gateway HTTP failures, schema rejections, malformed responses. Without
		// this log they surface to the browser as a dead stream with no reason.
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[chat] stream threw (${run.provider}/${run.model}, run=${run.runId}): ${message}`,
		);
		writeLine({
			kind: "stream-threw",
			runId: run.runId,
			message,
			stack: err instanceof Error ? clip(err.stack, 4000) : undefined,
		});
		throw err;
	}
}

import type { ChangeFn, ChangeOptions } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";

// Every Automerge change can carry an opaque `message`. We piggy-back on it
// for change-source attribution so the History drawer can show "AI" pills,
// system markers (branch-created, merge-applied), and filter chips — without a
// new storage column.
//
// The wire format is a JSON object with `{ source, kind?, payload? }`. The
// reader (`parseChangeMessage`) tolerates non-JSON / missing messages and
// falls back to `source: "user"` so legacy changes (pre-tagging) stay sane.

export type ChangeSource = "user" | "ai" | "system";

export type ChangeMessage = {
	source: ChangeSource;
	// System changes carry a kind so the UI can render the right marker.
	// E.g. "branch-created" on the new branch doc at fork time,
	// "branched-out" on the parent at the same instant,
	// "merge-applied" on the parent at successful merge time.
	kind?: string;
	// Free-form context attached to the change (e.g. branch title for
	// branch-created markers, AI tool name for ai-source changes).
	payload?: Record<string, unknown>;
};

export function encodeChangeMessage(msg: ChangeMessage): string {
	return JSON.stringify(msg);
}

export function parseChangeMessage(
	raw: string | null | undefined,
): ChangeMessage {
	if (!raw) return { source: "user" };
	try {
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === "object" &&
			"source" in parsed &&
			(parsed.source === "user" ||
				parsed.source === "ai" ||
				parsed.source === "system")
		) {
			return parsed as ChangeMessage;
		}
	} catch {
		// Non-JSON message (legacy or external). Fall through.
	}
	return { source: "user" };
}

// Wrap `handle.change` so every call site gets source-tagged uniformly. The
// `time` field is set explicitly to ms-epoch in seconds so the History drawer
// can show real timestamps (older Automerge versions wrote 0). Note: the
// Automerge change protocol stores `time` in seconds — we divide by 1000 here
// and `readHistory` multiplies back to ms when consuming.
export function changeWith<T>(
	handle: DocHandle<T>,
	source: ChangeSource,
	fn: ChangeFn<T>,
	extra?: { kind?: string; payload?: Record<string, unknown> },
): void {
	const message: ChangeMessage = { source };
	if (extra?.kind) message.kind = extra.kind;
	if (extra?.payload) message.payload = extra.payload;
	const options: ChangeOptions<T> = {
		message: encodeChangeMessage(message),
		time: Math.floor(Date.now() / 1000),
	};
	handle.change(fn, options);
}

// Pure string helpers for the chat's attached-file blocks.
//
// When the user attaches a file, its extracted text is appended to their
// message between "--- Attached: <name> ---" / "--- /Attached ---" markers
// (see file-extract.ts buildMessageWithAttachments). The MODEL needs the full
// content; the chat UI does not — a 200KB spec rendered verbatim makes the
// conversation unscrollable. parseAttachmentBlocks splits a stored user
// message back into the typed body and its attachment blocks so MessageRow
// can render compact, expandable chips instead.
//
// This module is dependency-free on purpose: chat-panel.tsx must be able to
// import it statically without pulling file-extract.ts (whose pdf/docx
// parsers are kept out of the chat chunk).

export const ATTACHMENT_BLOCK_START = "--- Attached: ";
export const ATTACHMENT_BLOCK_START_END = " ---";
export const ATTACHMENT_BLOCK_END = "--- /Attached ---";

export type ParsedAttachment = {
	// The label inside the start marker: filename plus optional " · N pages"
	// and " (truncated)" annotations, verbatim.
	label: string;
	// The extracted file content between the markers.
	content: string;
};

export type ParsedUserMessage = {
	// What the user actually typed (or the "Reference material attached:"
	// placeholder for drop-only sends).
	body: string;
	attachments: ParsedAttachment[];
};

// Splits a user message into typed body + attachment blocks. Messages without
// attachment markers come back unchanged with an empty attachments list.
// Tolerant of malformed input: an unterminated block is treated as plain text.
export function parseAttachmentBlocks(text: string): ParsedUserMessage {
	const attachments: ParsedAttachment[] = [];
	const bodyParts: string[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		const start = text.indexOf(ATTACHMENT_BLOCK_START, cursor);
		if (start < 0) {
			bodyParts.push(text.slice(cursor));
			break;
		}
		// The start marker must sit at the beginning of a line — "--- Attached:"
		// appearing mid-sentence is user text, not a block.
		if (start > 0 && text[start - 1] !== "\n") {
			const lineEnd = text.indexOf("\n", start);
			const sliceEnd = lineEnd < 0 ? text.length : lineEnd + 1;
			bodyParts.push(text.slice(cursor, sliceEnd));
			cursor = sliceEnd;
			continue;
		}
		const labelEnd = text.indexOf(ATTACHMENT_BLOCK_START_END, start);
		if (labelEnd < 0) {
			bodyParts.push(text.slice(cursor));
			break;
		}
		const contentStart = labelEnd + ATTACHMENT_BLOCK_START_END.length;
		const end = text.indexOf(ATTACHMENT_BLOCK_END, contentStart);
		if (end < 0) {
			// Unterminated block — keep it as visible text rather than hiding it.
			bodyParts.push(text.slice(cursor));
			break;
		}
		bodyParts.push(text.slice(cursor, start));
		const label = text.slice(start + ATTACHMENT_BLOCK_START.length, labelEnd);
		const content = text
			.slice(contentStart, end)
			.replace(/^\n/, "")
			.replace(/\n$/, "");
		attachments.push({ label, content });
		cursor = end + ATTACHMENT_BLOCK_END.length;
	}
	const body = bodyParts.join("").trim();
	return { body, attachments };
}

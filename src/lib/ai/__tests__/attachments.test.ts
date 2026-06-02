import { describe, expect, it } from "vitest";
import { parseAttachmentBlocks } from "../attachments";
import {
	buildMessageWithAttachments,
	type ExtractedFile,
	formatAttachmentBlock,
} from "../file-extract";

function file(overrides: Partial<ExtractedFile> = {}): ExtractedFile {
	return {
		name: "spec.md",
		kind: "text",
		text: "# Auth spec\n- OIDC discovery\n- Session refresh",
		truncated: false,
		...overrides,
	};
}

describe("parseAttachmentBlocks", () => {
	it("returns plain text untouched with no attachments", () => {
		const parsed = parseAttachmentBlocks("just a normal question");
		expect(parsed.body).toBe("just a normal question");
		expect(parsed.attachments).toEqual([]);
	});

	it("round-trips a message composed by buildMessageWithAttachments", () => {
		const composed = buildMessageWithAttachments("Estimate these tasks", [
			file(),
		]);
		const parsed = parseAttachmentBlocks(composed);
		expect(parsed.body).toBe("Estimate these tasks");
		expect(parsed.attachments).toHaveLength(1);
		expect(parsed.attachments[0].label).toBe("spec.md");
		expect(parsed.attachments[0].content).toBe(
			"# Auth spec\n- OIDC discovery\n- Session refresh",
		);
	});

	it("round-trips multiple attachments", () => {
		const composed = buildMessageWithAttachments("Compare these", [
			file({ name: "v1.md", text: "version one" }),
			file({ name: "v2.md", text: "version two" }),
		]);
		const parsed = parseAttachmentBlocks(composed);
		expect(parsed.body).toBe("Compare these");
		expect(parsed.attachments.map((a) => a.label)).toEqual(["v1.md", "v2.md"]);
		expect(parsed.attachments.map((a) => a.content)).toEqual([
			"version one",
			"version two",
		]);
	});

	it("keeps page-count and truncation annotations in the label", () => {
		const block = formatAttachmentBlock(
			file({ name: "plan.pdf", kind: "pdf", pages: 12, truncated: true }),
		);
		const parsed = parseAttachmentBlocks(block);
		expect(parsed.attachments).toHaveLength(1);
		expect(parsed.attachments[0].label).toBe("plan.pdf · 12 pages (truncated)");
	});

	it("uses the placeholder body for drop-only sends", () => {
		const composed = buildMessageWithAttachments("", [file()]);
		const parsed = parseAttachmentBlocks(composed);
		expect(parsed.body).toBe("Reference material attached:");
		expect(parsed.attachments).toHaveLength(1);
	});

	it("treats an unterminated block as plain text instead of hiding it", () => {
		const malformed = "look at this\n--- Attached: x.md ---\nno end marker";
		const parsed = parseAttachmentBlocks(malformed);
		expect(parsed.attachments).toEqual([]);
		expect(parsed.body).toContain("no end marker");
	});

	it("does not mistake a mid-sentence mention of the marker for a block", () => {
		const text =
			"I typed --- Attached: foo --- by hand, it is not a real block";
		const parsed = parseAttachmentBlocks(text);
		expect(parsed.attachments).toEqual([]);
		expect(parsed.body).toBe(text);
	});

	it("preserves attachment content that itself contains dashes and headers", () => {
		const tricky = "## Section\n---\nsome --- dashes --- inline\n- bullet";
		const composed = buildMessageWithAttachments("check", [
			file({ text: tricky }),
		]);
		const parsed = parseAttachmentBlocks(composed);
		expect(parsed.attachments[0].content).toBe(tricky);
	});
});

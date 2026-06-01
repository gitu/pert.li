import { describe, expect, it } from "vitest";
import {
	buildMessageWithAttachments,
	classify,
	extractText,
	formatAttachmentBlock,
	UnsupportedFileError,
} from "../file-extract";

function makeFile(name: string, content: string, type = ""): File {
	return new File([content], name, { type });
}

describe("classify", () => {
	it("recognises markdown, csv, json, plain text by extension", () => {
		expect(classify(makeFile("notes.md", ""))).toBe("text");
		expect(classify(makeFile("tasks.csv", ""))).toBe("text");
		expect(classify(makeFile("plan.json", ""))).toBe("text");
		expect(classify(makeFile("readme.txt", ""))).toBe("text");
	});

	it("recognises text mime types when extension is unknown", () => {
		expect(classify(makeFile("note", "", "text/plain"))).toBe("text");
		expect(classify(makeFile("config", "", "application/json"))).toBe("text");
	});

	it("recognises pdf and docx by extension or mime", () => {
		expect(classify(makeFile("spec.pdf", ""))).toBe("pdf");
		expect(
			classify(
				makeFile(
					"spec.docx",
					"",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				),
			),
		).toBe("docx");
	});

	it("throws on unsupported types so the UI surfaces a chip error", () => {
		expect(() => classify(makeFile("image.png", "", "image/png"))).toThrow(
			UnsupportedFileError,
		);
		expect(() => classify(makeFile("binary.bin", ""))).toThrow(
			UnsupportedFileError,
		);
	});
});

describe("extractText (plain text path)", () => {
	it("reads the file body verbatim", async () => {
		const file = makeFile(
			"notes.md",
			"# spec\n- estimate 3 days for OIDC discovery\n",
			"text/markdown",
		);
		const out = await extractText(file);
		expect(out.kind).toBe("text");
		expect(out.text).toContain("OIDC discovery");
		expect(out.truncated).toBe(false);
	});

	it("truncates text past the cap and marks the result", async () => {
		const big = "x".repeat(220_000);
		const file = makeFile("big.txt", big, "text/plain");
		const out = await extractText(file);
		expect(out.truncated).toBe(true);
		expect(out.text.length).toBeLessThan(big.length);
		expect(out.text).toContain("truncated to fit chat limit");
	});

	it("measures the cap in UTF-8 bytes, not UTF-16 code units", async () => {
		// CJK characters serialise to 3 UTF-8 bytes apiece. ~80k code units →
		// ~240k bytes, well past the 200k cap. The pre-fix code (text.length
		// vs MAX_EXTRACTED_BYTES) would have allowed this through untruncated.
		const codepoints = 80_000;
		const big = "中".repeat(codepoints);
		const file = makeFile("cjk.txt", big, "text/plain");
		const out = await extractText(file);
		expect(out.truncated).toBe(true);
		const byteLength = new TextEncoder().encode(out.text).byteLength;
		// Allow some headroom for the truncation marker itself.
		expect(byteLength).toBeLessThanOrEqual(200_000 + 200);
	});
});

describe("attachment formatting", () => {
	it("wraps content in matching markers the system prompt documents", () => {
		const block = formatAttachmentBlock({
			name: "spec.md",
			kind: "text",
			text: "hello",
			truncated: false,
		});
		expect(block.startsWith("--- Attached: spec.md ---")).toBe(true);
		expect(block.endsWith("--- /Attached ---")).toBe(true);
		expect(block).toContain("hello");
	});

	it("annotates truncated PDFs with page count + truncation flag", () => {
		const block = formatAttachmentBlock({
			name: "spec.pdf",
			kind: "pdf",
			text: "page text",
			pages: 12,
			truncated: true,
		});
		expect(block).toContain("12 pages");
		expect(block).toContain("(truncated)");
	});

	it("buildMessageWithAttachments keeps a no-attachment send untouched", () => {
		expect(buildMessageWithAttachments("hello", [])).toBe("hello");
	});

	it("buildMessageWithAttachments prepends a placeholder when the body is empty", () => {
		const composed = buildMessageWithAttachments("", [
			{
				name: "spec.md",
				kind: "text",
				text: "hi",
				truncated: false,
			},
		]);
		expect(composed).toMatch(/^Reference material attached:/);
		expect(composed).toContain("--- Attached: spec.md ---");
	});
});

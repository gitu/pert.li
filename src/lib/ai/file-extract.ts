// Browser-side file → plain text extraction for chat attachments. The chat
// backend stays text-only: every supported file type gets parsed in the
// browser and the extracted text is appended to the user's message as a
// fenced "--- Attached: <name> ---" block. That keeps the multi-provider
// adapter (Anthropic/OpenAI/Gemini) free of multipart bookkeeping and means
// the same flow works whether the user pastes a few lines or drops a PDF.
//
// PDF and DOCX parsers are loaded dynamically — both ship sizeable browser
// bundles and would bloat the initial chunk for users who never attach
// anything.

const TEXT_EXTENSIONS = new Set([
	"txt",
	"md",
	"markdown",
	"csv",
	"json",
	"log",
	"rst",
	"yaml",
	"yml",
]);

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
	"application/json",
	"application/x-yaml",
	"application/yaml",
]);

// 200 KB of extracted text — generous for project specs but bounded so a
// runaway PDF can't blow the model's context window before the operator
// sees the bill.
const MAX_EXTRACTED_BYTES = 200_000;
const TRUNCATION_MARKER = "\n\n…[truncated to fit chat limit]…";

export type ExtractKind = "text" | "pdf" | "docx";

export type ExtractedFile = {
	name: string;
	kind: ExtractKind;
	text: string;
	pages?: number;
	truncated: boolean;
};

export class UnsupportedFileError extends Error {
	readonly kind = "unsupported" as const;
	constructor(public readonly filename: string) {
		super(
			`Unsupported file type for "${filename}". Drop .txt, .md, .csv, .json, .pdf, or .docx.`,
		);
	}
}

export class FileExtractError extends Error {
	readonly kind = "extract-failed" as const;
	constructor(
		public readonly filename: string,
		public readonly cause: unknown,
	) {
		super(`Could not read "${filename}": ${describeCause(cause)}`);
	}
}

function describeCause(cause: unknown): string {
	if (cause instanceof Error) return cause.message;
	if (typeof cause === "string") return cause;
	return "unknown error";
}

function lowerExt(name: string): string {
	const idx = name.lastIndexOf(".");
	if (idx < 0) return "";
	return name.slice(idx + 1).toLowerCase();
}

export function classify(file: File): ExtractKind {
	const ext = lowerExt(file.name);
	if (ext === "pdf" || file.type === "application/pdf") return "pdf";
	if (
		ext === "docx" ||
		file.type ===
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	) {
		return "docx";
	}
	if (TEXT_EXTENSIONS.has(ext)) return "text";
	if (
		TEXT_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix)) ||
		TEXT_MIME_TYPES.has(file.type)
	) {
		return "text";
	}
	throw new UnsupportedFileError(file.name);
}

function truncate(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_EXTRACTED_BYTES) {
		return { text, truncated: false };
	}
	return {
		text: text.slice(0, MAX_EXTRACTED_BYTES) + TRUNCATION_MARKER,
		truncated: true,
	};
}

export async function extractText(file: File): Promise<ExtractedFile> {
	const kind = classify(file);
	try {
		if (kind === "text") return await extractPlainText(file);
		if (kind === "pdf") return await extractPdf(file);
		return await extractDocx(file);
	} catch (e) {
		if (e instanceof UnsupportedFileError) throw e;
		throw new FileExtractError(file.name, e);
	}
}

async function extractPlainText(file: File): Promise<ExtractedFile> {
	const raw = await file.text();
	const { text, truncated } = truncate(raw);
	return { name: file.name, kind: "text", text, truncated };
}

async function extractPdf(file: File): Promise<ExtractedFile> {
	// pdfjs ships with a worker module; we load it via the legacy entry which
	// does the worker plumbing internally for browser/Vite environments.
	const pdfjs = (await import(
		"pdfjs-dist/legacy/build/pdf.mjs"
	)) as typeof import("pdfjs-dist");
	// Pin the worker source to the matching bundled file. Vite resolves
	// `?url` imports to a hashed URL at build time so the worker is served
	// from the same origin and matches the API version exactly.
	const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url"))
		.default;
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

	const buf = await file.arrayBuffer();
	const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
	const doc = await loadingTask.promise;
	const pages: string[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const content = await page.getTextContent();
		const line = content.items
			// biome-ignore lint/suspicious/noExplicitAny: pdfjs TextItem|TextMarkedContent — we only care about items with a `.str`.
			.map((item: any) => (typeof item.str === "string" ? item.str : ""))
			.filter((s: string) => s.length > 0)
			.join(" ");
		pages.push(`--- page ${p} ---\n${line}`);
	}
	const raw = pages.join("\n\n");
	const { text, truncated } = truncate(raw);
	return {
		name: file.name,
		kind: "pdf",
		text,
		pages: doc.numPages,
		truncated,
	};
}

async function extractDocx(file: File): Promise<ExtractedFile> {
	// Mammoth ships a dual entry that picks the browser bundle automatically
	// in browser builds; the standard "mammoth" specifier has TypeScript
	// declarations, the explicit "/mammoth.browser" one does not.
	const mammoth = await import("mammoth");
	const buf = await file.arrayBuffer();
	const result = await mammoth.extractRawText({ arrayBuffer: buf });
	const { text, truncated } = truncate(result.value);
	return { name: file.name, kind: "docx", text, truncated };
}

// Format the extracted text for inclusion in a user message. The fenced
// "--- Attached: <name> ---" / "--- /Attached ---" markers are documented in
// the system prompt so the assistant treats the inner content as reference
// material instead of as the literal user ask.
export function formatAttachmentBlock(file: ExtractedFile): string {
	const trail = file.truncated ? " (truncated)" : "";
	const pageNote =
		file.kind === "pdf" && file.pages ? ` · ${file.pages} pages` : "";
	return [
		`--- Attached: ${file.name}${pageNote}${trail} ---`,
		file.text,
		`--- /Attached ---`,
	].join("\n");
}

// Compose a single user message that includes any free-text the user typed
// plus the attached files appended as fenced blocks. If `body` is empty
// (drop-only submit) we still send a short marker so the assistant knows
// to expect references in the attachment blocks.
export function buildMessageWithAttachments(
	body: string,
	attachments: ExtractedFile[],
): string {
	if (attachments.length === 0) return body;
	const blocks = attachments.map(formatAttachmentBlock).join("\n\n");
	const trimmedBody = body.trim();
	const intro =
		trimmedBody.length === 0 ? "Reference material attached:" : trimmedBody;
	return `${intro}\n\n${blocks}`;
}

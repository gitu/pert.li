import { FileTextIcon, Loader2Icon, PaperclipIcon, XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ExtractedFile } from "#/lib/ai/file-extract";
import { cn } from "#/lib/utils";

// Shared file-attachment plumbing used by both the chat input (chat-panel.tsx)
// and the "Describe with AI" project-creation dialog. Both let the user drop or
// pick local files, parse them in the browser via the dynamic-imported
// file-extract module (so pdfjs/mammoth stay out of the static chunk), and show
// per-file chips with parse/ready/error states. Keeping it in one place means
// the drag handling, error duck-typing, and chip rendering aren't duplicated.

// Accept list mirrors the file types file-extract.ts can parse.
export const ATTACHMENT_ACCEPT =
	".txt,.md,.markdown,.csv,.json,.log,.rst,.yaml,.yml,.pdf,.docx,text/*,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type AttachmentSlot = {
	id: string;
	file: File;
	status: "parsing" | "ready" | "error";
	extracted?: ExtractedFile;
	error?: string;
};

export type ReadyAttachment = AttachmentSlot & {
	status: "ready";
	extracted: ExtractedFile;
};

export function isReadyAttachment(a: AttachmentSlot): a is ReadyAttachment {
	return a.status === "ready" && !!a.extracted;
}

export function createAttachmentId(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `att_${s}`;
}

export function hasDataTransferFiles(e: React.DragEvent): boolean {
	const dt = e.dataTransfer;
	if (!dt) return false;
	if (dt.files && dt.files.length > 0) return true;
	// In a dragenter/dragover the file list isn't readable yet; fall back to
	// the type list which contains "Files" when the drag carries any.
	return Array.from(dt.types ?? []).includes("Files");
}

// `instanceof` checks would require a static import of the error classes;
// duck-type via the `kind` discriminator so the file-extract module stays
// purely dynamic-imported.
function isUnsupportedFileError(
	e: unknown,
): e is Error & { kind: "unsupported" } {
	return (
		e instanceof Error &&
		(e as Error & { kind?: string }).kind === "unsupported"
	);
}

function isFileExtractError(
	e: unknown,
): e is Error & { kind: "extract-failed" } {
	return (
		e instanceof Error &&
		(e as Error & { kind?: string }).kind === "extract-failed"
	);
}

// State + ingest/remove logic shared by both attachment surfaces. Each ingested
// file gets a slot that parses asynchronously; the slot id (not the array
// index) is captured so concurrent additions stay independent.
export function useFileAttachments() {
	const [attachments, setAttachments] = useState<AttachmentSlot[]>([]);
	const attachmentsBusy = attachments.some((a) => a.status === "parsing");

	const ingestFiles = useCallback((files: FileList | File[]) => {
		const list = Array.from(files);
		if (list.length === 0) return;
		setAttachments((current) => {
			const additions: AttachmentSlot[] = list.map((file) => ({
				id: createAttachmentId(),
				file,
				status: "parsing",
			}));
			for (const slot of additions) {
				void (async () => {
					try {
						const { classify, extractText } = await import(
							"#/lib/ai/file-extract"
						);
						// Pre-classify so unsupported types fail fast with a clearer
						// message instead of routing into a no-op text reader.
						classify(slot.file);
						const extracted = await extractText(slot.file);
						setAttachments((prev) =>
							prev.map((a) =>
								a.id === slot.id ? { ...a, status: "ready", extracted } : a,
							),
						);
					} catch (e) {
						const message =
							isUnsupportedFileError(e) || isFileExtractError(e)
								? e.message
								: e instanceof Error
									? e.message
									: "Could not read file";
						setAttachments((prev) =>
							prev.map((a) =>
								a.id === slot.id
									? { ...a, status: "error", error: message }
									: a,
							),
						);
					}
				})();
			}
			return [...current, ...additions];
		});
	}, []);

	const removeAttachment = useCallback((id: string) => {
		setAttachments((prev) => prev.filter((a) => a.id !== id));
	}, []);

	const clearAttachments = useCallback(() => setAttachments([]), []);

	return {
		attachments,
		attachmentsBusy,
		ingestFiles,
		removeAttachment,
		clearAttachments,
	};
}

export function AttachmentChip({
	slot,
	onRemove,
	testIdPrefix = "attachment",
}: {
	slot: AttachmentSlot;
	onRemove: () => void;
	testIdPrefix?: string;
}) {
	const truncated = slot.extracted?.truncated;
	const meta =
		slot.status === "parsing"
			? "Reading…"
			: slot.status === "error"
				? (slot.error ?? "Failed to read")
				: slot.extracted
					? `${slot.extracted.text.length.toLocaleString()} chars${truncated ? " · truncated" : ""}`
					: "";
	return (
		<div
			className={cn(
				"flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10px]",
				slot.status === "error"
					? "border-destructive/40 bg-destructive/10 text-destructive"
					: "border-border bg-muted/30",
			)}
			data-testid={`${testIdPrefix}-${slot.id}`}
			data-status={slot.status}
		>
			{slot.status === "parsing" ? (
				<Loader2Icon className="size-3 shrink-0 animate-spin" />
			) : (
				<FileTextIcon className="size-3 shrink-0" />
			)}
			<span className="truncate font-medium">{slot.file.name}</span>
			{meta && (
				<span className="truncate text-muted-foreground" title={meta}>
					· {meta}
				</span>
			)}
			<button
				type="button"
				onClick={onRemove}
				className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10"
				aria-label={`Remove attachment ${slot.file.name}`}
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}

// Self-contained drop zone + picker for the create-project dialog: a dashed
// click-to-attach area that also accepts drag-and-drop, with the chip list
// rendered underneath. The chat input renders its own inline layout instead and
// only reuses the hook + chip above.
export function AttachmentDropZone({
	attachments,
	onIngest,
	onRemove,
	disabled = false,
	hint = "Drop files or click to attach — specs, briefs, .md, .pdf, .docx",
}: {
	attachments: AttachmentSlot[];
	onIngest: (files: FileList | File[]) => void;
	onRemove: (id: string) => void;
	disabled?: boolean;
	hint?: string;
}) {
	const [isDragging, setIsDragging] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="space-y-1.5">
			<button
				type="button"
				disabled={disabled}
				onClick={() => fileInputRef.current?.click()}
				onDragEnter={(e) => {
					if (!hasDataTransferFiles(e)) return;
					e.preventDefault();
					setIsDragging(true);
				}}
				onDragOver={(e) => {
					if (!hasDataTransferFiles(e)) return;
					e.preventDefault();
				}}
				onDragLeave={(e) => {
					if (
						e.currentTarget instanceof HTMLElement &&
						!e.currentTarget.contains(e.relatedTarget as Node | null)
					) {
						setIsDragging(false);
					}
				}}
				onDrop={(e) => {
					if (!hasDataTransferFiles(e)) return;
					e.preventDefault();
					setIsDragging(false);
					onIngest(e.dataTransfer.files);
				}}
				className={cn(
					"flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
					isDragging
						? "border-primary/60 bg-primary/5 text-primary"
						: "border-border",
				)}
				data-testid="attachment-dropzone"
			>
				<PaperclipIcon className="size-3.5 shrink-0" />
				<span className="truncate">{hint}</span>
			</button>
			<input
				ref={fileInputRef}
				type="file"
				multiple
				className="hidden"
				accept={ATTACHMENT_ACCEPT}
				onChange={(e) => {
					if (e.target.files) onIngest(e.target.files);
					e.target.value = "";
				}}
				data-testid="attachment-file-input"
			/>
			{attachments.length > 0 && (
				<div className="flex flex-wrap gap-1" data-testid="attachment-chips">
					{attachments.map((a) => (
						<AttachmentChip
							key={a.id}
							slot={a}
							onRemove={() => onRemove(a.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

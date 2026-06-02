import { ChevronDownIcon, ChevronRightIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";
import { parseAttachmentBlocks } from "#/lib/ai/attachments";
import { cn } from "#/lib/utils";

// Renders the text of a USER chat message. Messages that carry attached-file
// blocks (the "--- Attached: <name> ---" fences produced when the user drops
// a file into the chat) are split: the typed body renders as text, and each
// attachment collapses into a small expandable chip. The full content still
// reaches the model — this is purely a display concern; without it a dropped
// PDF dumps hundreds of lines into the bubble.

export type UserMessageProps = {
	text: string;
};

export function UserMessage({ text }: UserMessageProps) {
	const parsed = parseAttachmentBlocks(text);
	if (parsed.attachments.length === 0) {
		return <>{text}</>;
	}
	return (
		<div className="flex flex-col gap-1.5">
			{parsed.body.length > 0 && <div>{parsed.body}</div>}
			{parsed.attachments.map((attachment, i) => (
				<AttachmentBlock
					// Labels can repeat (same file attached twice) — disambiguate by
					// position. The list is derived from immutable message text, so
					// positional keys can never be reordered out from under React.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above.
					key={`${attachment.label}-${i}`}
					label={attachment.label}
					content={attachment.content}
				/>
			))}
		</div>
	);
}

function AttachmentBlock({
	label,
	content,
}: {
	label: string;
	content: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div
			className="rounded border border-primary/20 bg-background/40 text-[10px]"
			data-testid="chat-user-attachment"
			data-state={open ? "open" : "closed"}
		>
			<button
				type="button"
				className="flex w-full items-center gap-1 px-1.5 py-1 text-left"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
			>
				{open ? (
					<ChevronDownIcon className="size-3 shrink-0" />
				) : (
					<ChevronRightIcon className="size-3 shrink-0" />
				)}
				<FileTextIcon className="size-3 shrink-0" />
				<span className="truncate font-medium">{label}</span>
				<span className="ml-auto shrink-0 text-muted-foreground">
					{content.length.toLocaleString()} chars
				</span>
			</button>
			{open && (
				<pre
					className={cn(
						"max-h-48 overflow-auto whitespace-pre-wrap break-all border-t",
						"bg-background/60 p-1.5 font-mono text-[10px]",
					)}
				>
					{content}
				</pre>
			)}
		</div>
	);
}

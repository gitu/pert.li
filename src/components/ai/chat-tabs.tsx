import { PlusIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import type { ThreadMeta } from "#/lib/chat-history";
import { cn } from "#/lib/utils";

export type ChatTabsProps = {
	threads: ThreadMeta[];
	activeThreadId: string;
	onSelect(id: string): void;
	onCreate(): void;
	onClose(id: string): void;
	onRename(id: string, title: string): void;
	// Best-effort signal to suppress the confirm() prompt on close when the
	// caller knows the thread has no messages yet. Defaults to false.
	isThreadEmpty?(id: string): boolean;
	className?: string;
};

export function ChatTabs({
	threads,
	activeThreadId,
	onSelect,
	onCreate,
	onClose,
	onRename,
	isThreadEmpty,
	className,
}: ChatTabsProps) {
	const handleClose = (id: string) => {
		const empty = isThreadEmpty?.(id) ?? false;
		if (empty) {
			onClose(id);
			return;
		}
		if (typeof window !== "undefined") {
			const ok = window.confirm(
				"Delete this chat thread? Its messages will be lost.",
			);
			if (!ok) return;
		}
		onClose(id);
	};
	return (
		<div
			data-testid="chat-tabs"
			className={cn(
				"flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-card/30 px-2 py-1 text-xs",
				className,
			)}
			role="tablist"
			aria-label="Chat threads"
		>
			{threads.map((t) => (
				<Tab
					key={t.id}
					thread={t}
					active={t.id === activeThreadId}
					onSelect={() => onSelect(t.id)}
					onClose={() => handleClose(t.id)}
					onRename={(next) => onRename(t.id, next)}
				/>
			))}
			<Button
				type="button"
				size="icon"
				variant="ghost"
				className="size-6 shrink-0"
				onClick={onCreate}
				aria-label="New chat thread"
				data-testid="chat-tab-new"
			>
				<PlusIcon className="size-3.5" />
			</Button>
		</div>
	);
}

type TabProps = {
	thread: ThreadMeta;
	active: boolean;
	onSelect(): void;
	onClose(): void;
	onRename(next: string): void;
};

function Tab({ thread, active, onSelect, onClose, onRename }: TabProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(thread.title);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (editing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editing]);

	useEffect(() => {
		// Keep the draft in sync when external rename arrives.
		if (!editing) setDraft(thread.title);
	}, [thread.title, editing]);

	const commit = () => {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== thread.title) {
			onRename(trimmed);
		} else {
			setDraft(thread.title);
		}
		setEditing(false);
	};

	const cancel = () => {
		setDraft(thread.title);
		setEditing(false);
	};

	const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			commit();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		}
	};

	return (
		<div
			role="tab"
			aria-selected={active}
			tabIndex={editing ? -1 : 0}
			data-testid={`chat-tab-${thread.id}`}
			data-active={active ? "true" : undefined}
			onClick={() => {
				if (!editing) onSelect();
			}}
			onKeyDown={(e) => {
				if (editing) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				} else if (e.key === "F2") {
					e.preventDefault();
					setEditing(true);
				}
			}}
			onDoubleClick={(e) => {
				e.preventDefault();
				setEditing(true);
			}}
			className={cn(
				"group flex shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
				active
					? "border-border bg-background text-foreground shadow-sm"
					: "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
			)}
		>
			{editing ? (
				<input
					ref={inputRef}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={onInputKey}
					onClick={(e) => e.stopPropagation()}
					className="w-32 rounded-sm border border-input bg-background px-1 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
					data-testid={`chat-tab-rename-${thread.id}`}
				/>
			) : (
				<span className="max-w-[12rem] truncate" title={thread.title}>
					{thread.title}
				</span>
			)}
			{!editing && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onClose();
					}}
					aria-label={`Close ${thread.title}`}
					data-testid={`chat-tab-close-${thread.id}`}
					className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[active]:opacity-100"
					data-active={active ? "true" : undefined}
				>
					<XIcon className="size-3" />
				</button>
			)}
		</div>
	);
}

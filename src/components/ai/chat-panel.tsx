import { fetchServerSentEvents } from "@tanstack/ai-client";
import { useChat } from "@tanstack/ai-react";
import {
	ArrowUpIcon,
	BotIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	SquareIcon,
	UserIcon,
	WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Textarea } from "#/components/ui/textarea";
import {
	addDependencyMutation,
	addTaskMutation,
	removeDependencyMutation,
	removeTaskMutation,
	setEstimateMutation,
	setTitleMutation,
	summarizeProject,
} from "#/lib/ai/tool-mutators";
import {
	addDependencyTool,
	addTaskTool,
	readProjectTool,
	removeDependencyTool,
	removeTaskTool,
	setEstimateTool,
	setTitleTool,
} from "#/lib/ai/tools";
import type { ChangeFn } from "#/lib/pert/store";
import { projectDocStore } from "#/lib/pert/store";
import type { PertDoc } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Chat surface backed by the /api/chat SSE endpoint. The hook owns the
// connection lifecycle (subscribe-on-mount, unsubscribe-on-unmount); we just
// render the messages and send a new one on Enter.
//
// The connection is constructed once and frozen for the lifetime of the
// component — useChat re-creates its internal client when the connection
// reference changes, so a stable ref matters more than dependency hygiene.

export type ChatPanelProps = {
	className?: string;
	endpoint?: string;
	initialPrompt?: string;
};

// Snapshot helper — tools execute outside React render, so we read the
// Store directly rather than via `useStore`. Returning null when no project
// is open lets each tool surface a useful error instead of mutating a
// stale doc.
function getActiveDoc(): { doc: PertDoc; changeDoc: ChangeFn } | null {
	const { doc, changeDoc } = projectDocStore.state;
	if (!doc || !changeDoc) return null;
	return { doc, changeDoc };
}

const noActiveProject = {
	ok: false as const,
	error: "No active project. Open one from the sidebar first.",
};

export function ChatPanel({
	className,
	endpoint = "/api/chat",
	initialPrompt,
}: ChatPanelProps) {
	const connectionRef = useRef(fetchServerSentEvents(endpoint));

	// Tools are stable for the lifetime of the panel — useChat re-creates the
	// underlying client on identity changes, which would drop the chat.
	const tools = useMemo(
		() =>
			[
				readProjectTool.client(() => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					return summarizeProject(active.doc);
				}),
				addTaskTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let id = "";
					active.changeDoc((d) => {
						id = addTaskMutation(d, args).id;
					});
					return { id };
				}),
				setEstimateTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setEstimateMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setEstimateMutation(d, args);
					});
					return result;
				}),
				setTitleTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setTitleMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setTitleMutation(d, args);
					});
					return result;
				}),
				addDependencyTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof addDependencyMutation> = { id: "" };
					active.changeDoc((d) => {
						result = addDependencyMutation(d, args);
					});
					return result;
				}),
				removeDependencyTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof removeDependencyMutation> = {
						ok: true,
					};
					active.changeDoc((d) => {
						result = removeDependencyMutation(d, args);
					});
					return result;
				}),
				removeTaskTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof removeTaskMutation> = { ok: true };
					active.changeDoc((d) => {
						result = removeTaskMutation(d, args);
					});
					return result;
				}),
			] as const,
		[],
	);

	const { messages, sendMessage, isLoading, error, stop } = useChat({
		connection: connectionRef.current,
		tools,
		live: true,
	});

	const [input, setInput] = useState(initialPrompt ?? "");
	const scrollRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: deps here are the trigger, not the read set — we want to auto-scroll on every message or streaming-state change.
	useEffect(() => {
		scrollRef.current?.scrollTo({
			top: scrollRef.current.scrollHeight,
			behavior: "smooth",
		});
	}, [messages, isLoading]);

	const submit = () => {
		const trimmed = input.trim();
		if (!trimmed || isLoading) return;
		setInput("");
		void sendMessage(trimmed);
	};

	return (
		<div
			data-testid="chat-panel"
			className={cn("flex h-full min-h-0 flex-col", className)}
		>
			<header className="flex shrink-0 items-center gap-2 border-b bg-card/40 px-3 py-2">
				<BotIcon className="size-3.5 text-muted-foreground" />
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Chat
				</div>
				<div className="ml-auto flex items-center gap-2">
					{isLoading && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 gap-1 px-2 text-[10px]"
							onClick={() => stop()}
							data-testid="chat-stop"
						>
							<SquareIcon className="size-3" /> Stop
						</Button>
					)}
				</div>
			</header>
			<ScrollArea className="flex-1" data-testid="chat-scroll">
				<div ref={scrollRef} className="space-y-3 p-3">
					{messages.length === 0 && (
						<EmptyState>
							Ask anything about your project — task breakdowns, estimates, or
							critical-path tradeoffs.
						</EmptyState>
					)}
					{messages.map((m) => (
						<MessageRow key={m.id} message={m} />
					))}
					{error && (
						<div
							data-testid="chat-error"
							className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
						>
							{error.message}
						</div>
					)}
				</div>
			</ScrollArea>
			<div className="shrink-0 border-t p-2">
				<div className="flex items-end gap-2">
					<Textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							// Cmd/Ctrl-Enter or plain Enter (without Shift) submits.
							if (
								e.key === "Enter" &&
								!e.shiftKey &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								submit();
							}
						}}
						placeholder={
							isLoading
								? "Streaming response…"
								: "Message — Enter to send, Shift-Enter for newline"
						}
						rows={2}
						disabled={isLoading}
						className="min-h-9 resize-none text-xs"
						data-testid="chat-input"
					/>
					<Button
						type="button"
						size="icon"
						className="size-9"
						onClick={submit}
						disabled={!input.trim() || isLoading}
						aria-label="Send message"
						data-testid="chat-send"
					>
						<ArrowUpIcon className="size-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}

function EmptyState({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
			<p className="max-w-sm">{children}</p>
		</div>
	);
}

type MessagePart = { type: string } & Record<string, unknown>;

type ChatMessage = {
	id: string;
	role: "system" | "user" | "assistant";
	parts: Array<MessagePart>;
};

function MessageRow({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const text = extractText(message);
	const toolCalls = extractToolCalls(message);
	const hasText = text.length > 0;
	const hasTools = toolCalls.length > 0;
	return (
		<div
			data-testid={`chat-message-${message.role}`}
			className={cn("flex gap-2", isUser && "flex-row-reverse")}
		>
			<div
				className={cn(
					"grid size-6 shrink-0 place-items-center rounded-full border bg-card text-[10px]",
					isUser ? "border-primary/40 text-primary" : "text-muted-foreground",
				)}
				aria-hidden
			>
				{isUser ? (
					<UserIcon className="size-3" />
				) : (
					<BotIcon className="size-3" />
				)}
			</div>
			<div
				className={cn(
					"flex max-w-[80%] flex-col gap-1.5 break-words rounded-md border px-2 py-1.5 text-xs",
					isUser
						? "border-primary/30 bg-primary/10 whitespace-pre-wrap"
						: "border-border bg-card/40",
				)}
			>
				{hasText ? (
					isUser ? (
						text
					) : (
						<div className="prose prose-xs prose-zinc dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_pre]:text-[10px] [&_code]:text-[10px]">
							<Streamdown parseIncompleteMarkdown>{text}</Streamdown>
						</div>
					)
				) : !hasTools ? (
					<span className="italic text-muted-foreground">…thinking…</span>
				) : null}
				{hasTools && (
					<div className="flex flex-col gap-1">
						{toolCalls.map((call) => (
							<ToolCallChip key={call.id} call={call} message={message} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

type ToolCallView = {
	id: string;
	name: string;
	args: string;
	state: string;
};

type ToolResultView = {
	toolCallId: string;
	content: string;
	state: string;
	error?: string;
};

function ToolCallChip({
	call,
	message,
}: {
	call: ToolCallView;
	message: ChatMessage;
}) {
	const result = extractToolResult(message, call.id);
	const [open, setOpen] = useState(false);
	const running = !result && call.state !== "complete";
	const failed = result?.state === "error" || !!result?.error;
	return (
		<div
			className={cn(
				"rounded border text-[10px]",
				failed
					? "border-destructive/40 bg-destructive/10"
					: running
						? "border-amber-500/40 bg-amber-500/5"
						: "border-border bg-muted/30",
			)}
			data-testid={`chat-tool-${call.name}`}
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
				<WrenchIcon className="size-3 shrink-0" />
				<span className="font-mono">{call.name}</span>
				<span className="ml-auto text-muted-foreground">
					{running ? "…" : failed ? "failed" : "done"}
				</span>
			</button>
			{open && (
				<div className="space-y-1 border-t bg-background/40 p-1.5 font-mono text-[10px]">
					<div>
						<div className="text-muted-foreground">args</div>
						<pre className="whitespace-pre-wrap break-all">
							{prettyJson(call.args)}
						</pre>
					</div>
					{result && (
						<div>
							<div className="text-muted-foreground">
								{failed ? "error" : "result"}
							</div>
							<pre className="whitespace-pre-wrap break-all">
								{result.error ?? prettyJson(result.content)}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function prettyJson(raw: string): string {
	if (!raw) return "";
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

function extractText(message: ChatMessage): string {
	return message.parts
		.filter((p) => p.type === "text")
		.map((p) => (typeof p.content === "string" ? p.content : ""))
		.join("");
}

function extractToolCalls(message: ChatMessage): Array<ToolCallView> {
	return message.parts
		.filter((p) => p.type === "tool-call")
		.map((p) => ({
			id: String(p.id ?? ""),
			name: String(p.name ?? ""),
			args: typeof p.arguments === "string" ? p.arguments : "",
			state: String(p.state ?? ""),
		}));
}

function extractToolResult(
	message: ChatMessage,
	toolCallId: string,
): ToolResultView | null {
	for (const p of message.parts) {
		if (p.type === "tool-result" && p.toolCallId === toolCallId) {
			return {
				toolCallId,
				content: typeof p.content === "string" ? p.content : "",
				state: String(p.state ?? ""),
				error: typeof p.error === "string" ? p.error : undefined,
			};
		}
	}
	return null;
}

import { fetchServerSentEvents } from "@tanstack/ai-client";
import { useChat } from "@tanstack/ai-react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
	ArrowUpIcon,
	BotIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	GridIcon,
	ListIcon,
	NetworkIcon,
	PinIcon,
	PinOffIcon,
	SquareIcon,
	TimerIcon,
	UserIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Textarea } from "#/components/ui/textarea";
import {
	addDependencyMutation,
	addInterfaceMutation,
	addTaskMutation,
	moveTaskMutation,
	pinDependencyMutation,
	removeDependencyMutation,
	removeInterfaceMutation,
	removeTaskMutation,
	setActualDatesMutation,
	setDependencyMutation,
	setEstimateMutation,
	setInterfaceMutation,
	setKeyMutation,
	setKindMutation,
	setNotesMutation,
	setProgressMutation,
	setStatusMutation,
	setTitleMutation,
	summarizeProject,
} from "#/lib/ai/tool-mutators";
import {
	addDependencyTool,
	addInterfaceTool,
	addTaskTool,
	askChoiceTool,
	moveTaskTool,
	pinDependencyTool,
	readProjectTool,
	removeDependencyTool,
	removeInterfaceTool,
	removeTaskTool,
	setActualDatesTool,
	setDependencyTool,
	setEstimateTool,
	setInterfaceTool,
	setKeyTool,
	setKindTool,
	setNotesTool,
	setProgressTool,
	setStatusTool,
	setTitleTool,
} from "#/lib/ai/tools";
import {
	chatDock,
	useChatDockMode,
	useChatDockPendingPrompt,
} from "#/lib/chat-dock";
import {
	type ChatBroadcast,
	type ChatBroadcaster,
	type ChatMessagesSnapshot,
	createChatBroadcaster,
	DEFAULT_THREAD_TITLE,
	deriveThreadTitle,
	getScopeKey,
	readThreadIndex,
	readThreadMessages,
	type ThreadIndex,
	type ThreadMeta,
	writeThreadIndex,
	writeThreadMessages,
} from "#/lib/chat-history";
import type { ChangeFn } from "#/lib/pert/store";
import { projectDocStore } from "#/lib/pert/store";
import type { PertDoc } from "#/lib/pert/types";
import { useIsMobile } from "#/lib/use-media-query";
import { cn } from "#/lib/utils";
import type { ProjectView } from "#/routes/_app/p.$projectId";
import { ChatTabs } from "./chat-tabs";

// Chat surface backed by the /api/chat SSE endpoint. The hook owns the
// connection lifecycle (subscribe-on-mount, unsubscribe-on-unmount); we just
// render the messages and send a new one on Enter.
//
// The connection is constructed once and frozen for the lifetime of the
// component — useChat re-creates its internal client when the connection
// reference changes, so a stable ref matters more than dependency hygiene.
//
// Threads
// -------
// The outer `ChatPanel` owns the tab strip and the per-scope thread index.
// One inner `ChatThread` (keyed by activeThreadId) drives `useChat` for the
// currently-visible conversation. Switching tabs remounts the inner thread,
// which is the cleanest way to make `useChat` reload its initialMessages
// without fighting its internal state.

export type ChatPanelProps = {
	className?: string;
	endpoint?: string;
	initialPrompt?: string;
	// When true (and `initialPrompt` is set), submit the prompt as soon as the
	// chat connection is alive. Used by tutorial CTAs that want a one-click
	// "open the chat and ask this for me" experience.
	autoSendInitial?: boolean;
	// Show the chrome that lets the user pin/unpin or dismiss the chat.
	// Defaults to false so the standalone (Storybook / playground) mounts stay
	// frictionless; the app shell sets it to true.
	showDockControls?: boolean;
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

// Imperative API exposed by ChatThread so the outer panel can route dock
// pending prompts into the active thread without lifting useChat state up.
type ChatThreadAPI = {
	sendMessage(text: string): void;
	setInput(text: string): void;
};

export function ChatPanel({
	className,
	endpoint = "/api/chat",
	initialPrompt,
	autoSendInitial = false,
	showDockControls = false,
}: ChatPanelProps) {
	const projectId = useStore(projectDocStore, (s) => s.projectId);
	const scopeKey = getScopeKey(projectId);

	// Thread index for the current scope. Seeded from localStorage on first
	// access; re-read whenever the scope changes (e.g. user opens a different
	// project). The seed call guarantees `threads.length >= 1`.
	const [index, setIndex] = useState<ThreadIndex>(() =>
		readThreadIndex(scopeKey),
	);
	useEffect(() => {
		setIndex(readThreadIndex(scopeKey));
	}, [scopeKey]);

	const activeThreadId = index.activeThreadId;
	// Per-thread snapshot of message counts — populated by ChatThread via
	// `onMessagesChanged`. Used to suppress the close-confirm prompt when a
	// thread is still empty.
	const messageCountsRef = useRef<Map<string, number>>(new Map());

	// Broadcaster is shared across the panel's lifetime. Inner ChatThread
	// subscribes/unsubscribes around its own message channel; we subscribe
	// here for index events so adding/renaming a thread in another tab shows
	// up live.
	const broadcasterRef = useRef<ChatBroadcaster | null>(null);
	if (broadcasterRef.current === null) {
		broadcasterRef.current = createChatBroadcaster();
	}
	useEffect(() => {
		const bus = broadcasterRef.current;
		return () => {
			bus?.close();
			broadcasterRef.current = null;
		};
	}, []);

	// Apply remote index changes from other tabs in the same scope. The
	// storage-event fallback also produces these. Same-tab posts are skipped
	// via the serial dedupe so we don't apply our own broadcasts.
	const lastIndexSerialRef = useRef<string | null>(null);
	useEffect(() => {
		const bus = broadcasterRef.current;
		if (!bus) return;
		const unsub = bus.subscribe((payload) => {
			if (payload.type !== "index") return;
			if (payload.scopeKey !== scopeKey) return;
			const serial = JSON.stringify(payload.index);
			if (serial === lastIndexSerialRef.current) return;
			lastIndexSerialRef.current = serial;
			setIndex(payload.index);
		});
		return () => {
			unsub();
		};
	}, [scopeKey]);

	const persistIndex = useCallback(
		(next: ThreadIndex) => {
			const serial = JSON.stringify(next);
			lastIndexSerialRef.current = serial;
			writeThreadIndex(scopeKey, next);
			broadcasterRef.current?.post({
				type: "index",
				scopeKey,
				index: next,
			});
		},
		[scopeKey],
	);

	const updateIndex = useCallback(
		(updater: (prev: ThreadIndex) => ThreadIndex) => {
			setIndex((prev) => {
				const next = updater(prev);
				persistIndex(next);
				return next;
			});
		},
		[persistIndex],
	);

	const onSelectThread = useCallback(
		(id: string) => {
			updateIndex((prev) => {
				if (prev.activeThreadId === id) return prev;
				return { ...prev, activeThreadId: id };
			});
		},
		[updateIndex],
	);

	const onCreateThread = useCallback(() => {
		updateIndex((prev) => {
			const now = Date.now();
			const newId =
				typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
					? crypto.randomUUID()
					: `t_${Math.random().toString(36).slice(2)}_${now.toString(36)}`;
			const meta: ThreadMeta = {
				id: newId,
				title: DEFAULT_THREAD_TITLE,
				createdAt: now,
				updatedAt: now,
			};
			return {
				activeThreadId: newId,
				threads: [...prev.threads, meta],
			};
		});
	}, [updateIndex]);

	const onCloseThread = useCallback(
		(id: string) => {
			updateIndex((prev) => {
				if (prev.threads.length <= 1) return prev;
				const idx = prev.threads.findIndex((t) => t.id === id);
				if (idx < 0) return prev;
				const nextThreads = prev.threads.filter((t) => t.id !== id);
				let nextActive = prev.activeThreadId;
				if (prev.activeThreadId === id) {
					const neighbor =
						nextThreads[idx] ?? nextThreads[idx - 1] ?? nextThreads[0];
					nextActive = neighbor.id;
				}
				return { activeThreadId: nextActive, threads: nextThreads };
			});
			messageCountsRef.current.delete(id);
		},
		[updateIndex],
	);

	const onRenameThread = useCallback(
		(id: string, title: string) => {
			updateIndex((prev) => {
				const next = prev.threads.map((t) =>
					t.id === id ? { ...t, title, updatedAt: Date.now() } : t,
				);
				return { ...prev, threads: next };
			});
		},
		[updateIndex],
	);

	// Bubble auto-title up when the inner thread sees its first user message.
	// We only overwrite the placeholder; user-renamed titles are preserved.
	const onAutoTitle = useCallback(
		(id: string, derived: string) => {
			updateIndex((prev) => {
				const target = prev.threads.find((t) => t.id === id);
				if (!target) return prev;
				if (target.title !== DEFAULT_THREAD_TITLE) return prev;
				const next = prev.threads.map((t) =>
					t.id === id ? { ...t, title: derived, updatedAt: Date.now() } : t,
				);
				return { ...prev, threads: next };
			});
		},
		[updateIndex],
	);

	const onMessagesChanged = useCallback((id: string, count: number) => {
		messageCountsRef.current.set(id, count);
	}, []);

	const isThreadEmpty = useCallback((id: string) => {
		const count = messageCountsRef.current.get(id);
		if (count === undefined) {
			// Fall back to inspecting localStorage so closing an unmounted thread
			// (e.g. one that was opened in a previous session) is still smooth.
			const snap = readThreadMessages(id);
			return !snap || snap.length === 0;
		}
		return count === 0;
	}, []);

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
				setKindTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setKindMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setKindMutation(d, args);
					});
					return result;
				}),
				setKeyTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setKeyMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setKeyMutation(d, args);
					});
					return result;
				}),
				setNotesTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setNotesMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setNotesMutation(d, args);
					});
					return result;
				}),
				moveTaskTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof moveTaskMutation> = { ok: true };
					active.changeDoc((d) => {
						result = moveTaskMutation(d, args);
					});
					return result;
				}),
				setStatusTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setStatusMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setStatusMutation(d, args);
					});
					return result;
				}),
				setProgressTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setProgressMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setProgressMutation(d, args);
					});
					return result;
				}),
				setActualDatesTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setActualDatesMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setActualDatesMutation(d, args);
					});
					return result;
				}),
				setDependencyTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setDependencyMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setDependencyMutation(d, args);
					});
					return result;
				}),
				addInterfaceTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof addInterfaceMutation> = { id: "" };
					active.changeDoc((d) => {
						result = addInterfaceMutation(d, args);
					});
					return result;
				}),
				removeInterfaceTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof removeInterfaceMutation> = { ok: true };
					active.changeDoc((d) => {
						result = removeInterfaceMutation(d, args);
					});
					return result;
				}),
				setInterfaceTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof setInterfaceMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setInterfaceMutation(d, args);
					});
					return result;
				}),
				pinDependencyTool.client((args) => {
					const active = getActiveDoc();
					if (!active) return noActiveProject;
					let result: ReturnType<typeof pinDependencyMutation> = { ok: true };
					active.changeDoc((d) => {
						result = pinDependencyMutation(d, args);
					});
					return result;
				}),
				// ask_choice is pure UI — acknowledge immediately so the model loop
				// continues. The chips themselves are rendered below from the message
				// log; clicking one sends the option's value as a normal user message.
				askChoiceTool.client(() => ({ ok: true as const })),
			] as const,
		[],
	);

	// Imperative handle into the active ChatThread; used by the dock pending-
	// prompt effect below. ChatThread reports its API on mount via the
	// registerAPI prop and tears it down on unmount.
	const threadApiRef = useRef<ChatThreadAPI | null>(null);
	const registerThreadAPI = useCallback((api: ChatThreadAPI | null) => {
		threadApiRef.current = api;
	}, []);

	const dockPending = useChatDockPendingPrompt();
	useEffect(() => {
		if (!dockPending) return;
		chatDock.consumePendingPrompt();
		const api = threadApiRef.current;
		if (!api) return;
		if (dockPending.autoSend) {
			api.sendMessage(dockPending.text);
		} else {
			api.setInput(dockPending.text);
		}
	}, [dockPending]);

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
				<div className="ml-auto flex items-center gap-1">
					{showDockControls && <ChatDockControls />}
				</div>
			</header>
			<ChatTabs
				threads={index.threads}
				activeThreadId={activeThreadId}
				onSelect={onSelectThread}
				onCreate={onCreateThread}
				onClose={onCloseThread}
				onRename={onRenameThread}
				isThreadEmpty={isThreadEmpty}
			/>
			<ChatThread
				key={activeThreadId}
				threadId={activeThreadId}
				scopeKey={scopeKey}
				endpoint={endpoint}
				initialPrompt={initialPrompt}
				autoSendInitial={autoSendInitial}
				tools={tools}
				broadcaster={broadcasterRef.current}
				registerAPI={registerThreadAPI}
				onAutoTitle={(derived) => onAutoTitle(activeThreadId, derived)}
				onMessagesChanged={(count) => onMessagesChanged(activeThreadId, count)}
			/>
		</div>
	);
}

type ChatThreadProps = {
	threadId: string;
	scopeKey: string;
	endpoint: string;
	initialPrompt?: string;
	autoSendInitial: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: tools array is opaque to us — useChat owns the shape.
	tools: ReadonlyArray<any>;
	broadcaster: ChatBroadcaster | null;
	registerAPI(api: ChatThreadAPI | null): void;
	onAutoTitle(derived: string): void;
	onMessagesChanged(count: number): void;
};

function ChatThread({
	threadId,
	scopeKey,
	endpoint,
	initialPrompt,
	autoSendInitial,
	tools,
	broadcaster,
	registerAPI,
	onAutoTitle,
	onMessagesChanged,
}: ChatThreadProps) {
	const connectionRef = useRef(fetchServerSentEvents(endpoint));

	// Hydrate from localStorage on mount so the chat survives a reload. The
	// snapshot is opaque to us — useChat's UIMessage shape can change between
	// library versions and we'd rather hand it back unchanged than try to
	// keep our types in sync. Worst case (malformed payload) we drop it.
	const initialMessagesRef = useRef(readThreadMessages(threadId) ?? undefined);

	const { messages, sendMessage, isLoading, error, stop, setMessages } =
		useChat({
			connection: connectionRef.current,
			tools,
			live: true,
			// biome-ignore lint/suspicious/noExplicitAny: the stored snapshot is opaque on purpose — see initialMessagesRef.
			initialMessages: initialMessagesRef.current as any,
		});

	// Persist to localStorage + broadcast to other tabs.
	// While `isLoading` is true the assistant is streaming and `messages`
	// emits a new array per token — JSON.stringify + localStorage.setItem +
	// BroadcastChannel.post on every one of those was the worst single source
	// of chat-dock lag. Debounce writes during streaming and flush once when
	// streaming ends; outside streaming, persist synchronously so sends /
	// resets land immediately.
	const lastBroadcastSerialRef = useRef<string | null>(null);
	const pendingPersistRef = useRef<number | null>(null);
	useEffect(() => {
		if (!broadcaster) return;
		const persist = () => {
			pendingPersistRef.current = null;
			try {
				const serial = JSON.stringify(messages);
				if (serial === lastBroadcastSerialRef.current) return;
				lastBroadcastSerialRef.current = serial;
				const snapshot = messages as unknown as ChatMessagesSnapshot;
				writeThreadMessages(threadId, snapshot);
				broadcaster.post({
					type: "messages",
					scopeKey,
					threadId,
					snapshot,
				});
			} catch {
				// non-serialisable payload (cyclical objects, functions in args) —
				// drop persistence rather than crashing the chat.
			}
		};
		if (isLoading) {
			if (pendingPersistRef.current !== null) {
				window.clearTimeout(pendingPersistRef.current);
			}
			pendingPersistRef.current = window.setTimeout(persist, 400);
			return () => {
				if (pendingPersistRef.current !== null) {
					window.clearTimeout(pendingPersistRef.current);
					pendingPersistRef.current = null;
				}
			};
		}
		if (pendingPersistRef.current !== null) {
			window.clearTimeout(pendingPersistRef.current);
			pendingPersistRef.current = null;
		}
		persist();
	}, [broadcaster, messages, scopeKey, threadId, isLoading]);

	// Auto-derive a thread title from the first user message and report message
	// count up to the parent so the close-confirm can stay silent on empties.
	useEffect(() => {
		onMessagesChanged(messages.length);
		const snapshot = messages as unknown as ChatMessagesSnapshot;
		const derived = deriveThreadTitle(snapshot);
		if (derived) onAutoTitle(derived);
	}, [messages, onAutoTitle, onMessagesChanged]);

	// Remote tabs writing into the same channel get applied here. The
	// serial-tracking ref also dedupes our own broadcasts so we don't loop.
	useEffect(() => {
		if (!broadcaster) return;
		const unsub = broadcaster.subscribe((payload: ChatBroadcast) => {
			if (payload.type !== "messages") return;
			if (payload.threadId !== threadId) return;
			const serial = JSON.stringify(payload.snapshot);
			if (serial === lastBroadcastSerialRef.current) return;
			lastBroadcastSerialRef.current = serial;
			// biome-ignore lint/suspicious/noExplicitAny: see initialMessagesRef.
			setMessages(payload.snapshot as any);
		});
		return () => {
			unsub();
		};
	}, [broadcaster, setMessages, threadId]);

	const [input, setInput] = useState(
		autoSendInitial ? "" : (initialPrompt ?? ""),
	);
	const scrollRef = useRef<HTMLDivElement>(null);
	const autoSentRef = useRef(false);

	// Expose imperative API to the outer panel for dock pending prompts.
	useEffect(() => {
		registerAPI({
			sendMessage: (text) => {
				void sendMessage(text);
			},
			setInput: (text) => {
				setInput(text);
			},
		});
		return () => registerAPI(null);
	}, [registerAPI, sendMessage]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: deps here are the trigger, not the read set — we want to auto-scroll on every message or streaming-state change.
	useEffect(() => {
		// The scrollable element is Radix's ScrollArea Viewport, not the inner
		// div we attached the ref to. Walk up to find it; the inner div itself
		// has `overflow: visible` and scrolling it is a no-op.
		const viewport = scrollRef.current?.closest(
			"[data-slot='scroll-area-viewport']",
		);
		if (viewport instanceof HTMLElement) {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
		}
	}, [messages, isLoading]);

	// One-shot auto-send for the initial prompt prop (kept for Storybook /
	// standalone mounts that drive ChatPanel directly without the dock store).
	useEffect(() => {
		if (!autoSendInitial || !initialPrompt) return;
		if (autoSentRef.current) return;
		autoSentRef.current = true;
		void sendMessage(initialPrompt);
	}, [autoSendInitial, initialPrompt, sendMessage]);

	const submit = () => {
		const trimmed = input.trim();
		if (!trimmed || isLoading) return;
		setInput("");
		void sendMessage(trimmed);
	};

	// Any ask_choice tool calls emitted AFTER the last user message are still
	// awaiting a response. Once the user types or clicks an option a new user
	// message lands and the prompts fall out of "pending" automatically.
	const pendingChoice = useMemo(
		() => findPendingChoice(messages as ChatMessage[]),
		[messages],
	);

	const chooseOption = (value: string) => {
		if (isLoading) return;
		setInput("");
		void sendMessage(value);
	};

	return (
		<>
			{isLoading && (
				<div className="flex shrink-0 items-center justify-end border-b bg-card/40 px-3 py-1">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-[10px]"
						onClick={() => stop()}
						data-testid="chat-stop"
					>
						<SquareIcon className="size-3" /> Stop
					</Button>
				</div>
			)}
			<ScrollArea className="min-h-0 flex-1" data-testid="chat-scroll">
				<div ref={scrollRef} className="space-y-3 p-3">
					{messages.length === 0 && (
						<EmptyState
							onSeed={(text) => {
								setInput("");
								void sendMessage(text);
							}}
						/>
					)}
					{(messages as unknown as ChatMessage[]).map((m) => (
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
			{pendingChoice && (
				<ChoicePrompt
					prompt={pendingChoice}
					disabled={isLoading}
					onChoose={chooseOption}
				/>
			)}
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
		</>
	);
}

type ChoiceOption = { label: string; value?: string };

export type PendingChoice = {
	toolCallId: string;
	question: string;
	options: ChoiceOption[];
};

// Walks the message log to find an unresolved `ask_choice` call: any
// ask_choice tool-call that appears AFTER the last user message and whose
// arguments are present + valid. Returns the most recent one (the model
// occasionally re-asks if it didn't get a response).
export function findPendingChoice(
	messages: ChatMessage[],
): PendingChoice | null {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			lastUserIdx = i;
			break;
		}
	}
	let candidate: PendingChoice | null = null;
	for (let i = lastUserIdx + 1; i < messages.length; i++) {
		for (const part of messages[i].parts) {
			if (part.type !== "tool-call") continue;
			if (part.name !== "ask_choice") continue;
			const parsed = parseChoiceArgs(part.arguments);
			if (!parsed) continue;
			candidate = { toolCallId: String(part.id ?? ""), ...parsed };
		}
	}
	return candidate;
}

function parseChoiceArgs(
	raw: unknown,
): { question: string; options: ChoiceOption[] } | null {
	if (typeof raw !== "string" || !raw) return null;
	try {
		const obj = JSON.parse(raw) as {
			question?: unknown;
			options?: unknown;
		};
		if (typeof obj.question !== "string") return null;
		if (!Array.isArray(obj.options)) return null;
		const options: ChoiceOption[] = [];
		for (const opt of obj.options) {
			if (!opt || typeof opt !== "object") continue;
			const o = opt as { label?: unknown; value?: unknown };
			if (typeof o.label !== "string" || !o.label) continue;
			options.push({
				label: o.label,
				value: typeof o.value === "string" ? o.value : undefined,
			});
		}
		if (options.length === 0) return null;
		return { question: obj.question, options };
	} catch {
		return null;
	}
}

export function ChoicePrompt({
	prompt,
	disabled,
	onChoose,
}: {
	prompt: PendingChoice;
	disabled: boolean;
	onChoose: (value: string) => void;
}) {
	return (
		<div
			className="shrink-0 border-t bg-muted/20 px-3 py-2"
			data-testid="chat-choice-prompt"
			data-tool-call-id={prompt.toolCallId}
		>
			<div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				Pick one — or type your own
			</div>
			<div className="mb-2 text-xs leading-snug">{prompt.question}</div>
			<div className="flex flex-wrap gap-1.5">
				{prompt.options.map((opt) => (
					<Button
						// Scoped by toolCallId so duplicate labels across re-asks don't
						// collide; within a single prompt labels are unique enough.
						key={`${prompt.toolCallId}-${opt.label}`}
						type="button"
						size="sm"
						variant="secondary"
						className="h-7 text-[11px]"
						disabled={disabled}
						onClick={() => onChoose(opt.value ?? opt.label)}
						data-testid="chat-choice-option"
					>
						{opt.label}
					</Button>
				))}
			</div>
		</div>
	);
}

function ChatDockControls() {
	const mode = useChatDockMode();
	const pinned = mode === "pinned";
	// Pinning has no target on the mobile shell — there is no resizable column
	// to dock into. Hide the pin control entirely so the user is not offered a
	// non-functional affordance.
	const isMobile = useIsMobile();
	return (
		<>
			{!isMobile && (
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-7"
					onClick={() => chatDock.togglePin()}
					aria-label={pinned ? "Unpin chat" : "Pin chat to side"}
					aria-pressed={pinned}
					data-testid="chat-pin-toggle"
				>
					{pinned ? (
						<PinOffIcon className="size-3.5" />
					) : (
						<PinIcon className="size-3.5" />
					)}
				</Button>
			)}
			<Button
				type="button"
				size="icon"
				variant="ghost"
				className="size-7"
				onClick={() => chatDock.close()}
				aria-label="Close chat"
				data-testid="chat-close"
			>
				<XIcon className="size-3.5" />
			</Button>
		</>
	);
}

export const TUTORIAL_SEEDS: ReadonlyArray<{ label: string; prompt: string }> =
	[
		{
			label: "What is PERT?",
			prompt:
				"I'm new to PERT. Give me a beginner-friendly intro: what it is, what problem it solves, and the few terms I should know (three-point estimate, critical path, slack). Keep it under ~200 words and end by offering to walk me through a concrete example.",
		},
		{
			label: "Three-point estimates",
			prompt:
				"Teach me how three-point estimates (optimistic / most likely / pessimistic) work in PERT. Show the expected duration formula and one concrete worked example. Then ask if I want to try estimating a task of my own.",
		},
		{
			label: "Critical path explained",
			prompt:
				"Explain the critical path in plain language. Use a small 4-task example with dependencies, walk through ES/EF/LS/LF and slack, and call out which path is critical and why.",
		},
		{
			label: "Walk me through pert.li",
			prompt:
				"Walk me through pert.li like a tutorial. Explain the canvas, list, timeline, table, and matrix views; the inspector; and how to create tasks, set estimates, and wire dependencies. Pause for questions after each section.",
		},
	];

function EmptyState({ onSeed }: { onSeed: (text: string) => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center">
			<p className="max-w-sm text-sm text-muted-foreground">
				Ask anything about your project — or start a quick tutorial below.
			</p>
			<div className="flex w-full max-w-sm flex-wrap justify-center gap-1.5">
				{TUTORIAL_SEEDS.map((seed) => (
					<Button
						key={seed.label}
						type="button"
						size="sm"
						variant="secondary"
						className="h-7 text-[11px]"
						onClick={() => onSeed(seed.prompt)}
						data-testid={`chat-seed-${seed.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
					>
						{seed.label}
					</Button>
				))}
			</div>
		</div>
	);
}

type MessagePart = { type: string } & Record<string, unknown>;

export type ChatMessage = {
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
	// `read_project` returns the active plan. Show the four view options so
	// the user can jump straight to Network / Timeline / Table / Matrix
	// without leaving the chat — the plan being discussed is the project the
	// main pane is already pointing at.
	const showPlanViews = call.name === "read_project" && !!result && !failed;
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
			{showPlanViews && <PlanViewSwitcher />}
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

const PLAN_VIEW_TABS: Array<{
	id: ProjectView;
	label: string;
	Icon: typeof NetworkIcon;
}> = [
	{ id: "network", label: "Network", Icon: NetworkIcon },
	{ id: "timeline", label: "Timeline", Icon: TimerIcon },
	{ id: "table", label: "Table", Icon: ListIcon },
	{ id: "matrix", label: "Matrix", Icon: GridIcon },
];

// Compact mirror of the project-header tab strip, rendered inside the chat's
// `read_project` chip so the user can pivot the main pane between views
// while still reading the assistant's reply. Routes the click through the
// same `/p/$projectId?view=` query the header tabs use (network → no param).
export function PlanViewSwitcher() {
	const navigate = useNavigate();
	const params = useParams({ strict: false }) as { projectId?: string };
	const search = useSearch({ strict: false }) as { view?: ProjectView };
	const projectId = useStore(projectDocStore, (s) => s.projectId);
	// Fall back to the active project from the doc store when the chat is
	// floating over a non-project route — the URL still controls the main
	// pane, so prefer the route param when it's there.
	const targetProjectId = params.projectId ?? projectId;
	if (!targetProjectId) return null;
	const active: ProjectView = search.view ?? "network";
	return (
		<div
			className="flex flex-wrap items-center gap-1 border-t bg-background/40 px-1.5 py-1 text-[10px]"
			data-testid="chat-plan-view-switcher"
		>
			<span className="text-muted-foreground">View as</span>
			{PLAN_VIEW_TABS.map((tab) => {
				const isActive = active === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						aria-pressed={isActive}
						data-testid={`chat-plan-view-${tab.id}`}
						onClick={() => {
							if (isActive) return;
							navigate({
								to: "/p/$projectId",
								params: { projectId: targetProjectId },
								search: { view: tab.id === "network" ? undefined : tab.id },
								replace: true,
							});
						}}
						className={cn(
							"inline-flex h-5 items-center gap-1 rounded px-1.5",
							isActive
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
						)}
					>
						<tab.Icon className="size-3" />
						{tab.label}
					</button>
				);
			})}
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
	return (
		message.parts
			.filter((p) => p.type === "tool-call")
			.map((p) => ({
				id: String(p.id ?? ""),
				name: String(p.name ?? ""),
				args: typeof p.arguments === "string" ? p.arguments : "",
				state: String(p.state ?? ""),
			}))
			// `ask_choice` is pure UI — the question + chips render below the
			// chat scroller. Showing a "wrench chip" for it would be redundant.
			.filter((c) => c.name !== "ask_choice")
	);
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

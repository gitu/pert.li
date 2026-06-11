import { fetchServerSentEvents } from "@tanstack/ai-client";
import { useChat } from "@tanstack/ai-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
	PaperclipIcon,
	PinIcon,
	PinOffIcon,
	PlusIcon,
	SquareIcon,
	TimerIcon,
	UserIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Streamdown } from "streamdown";
import {
	AttachmentChip,
	hasDataTransferFiles,
	isReadyAttachment,
	useFileAttachments,
} from "#/components/ai/attachment-input";
import { ACTION_SEEDS, TUTORIAL_SEEDS } from "#/components/ai/tutorial-seeds";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Textarea } from "#/components/ui/textarea";
import { formatToolError } from "#/lib/ai/format-tool-error";
import type { EditOp } from "#/lib/ai/operations";
import { applyProposal, stageProposal } from "#/lib/ai/proposals-store";
import { withToolLogging } from "#/lib/ai/tool-log";
import {
	addDependencyMutation,
	addTaskMutation,
	assignTaskToGroupMutation,
	createGroupMutation,
	deleteGroupMutation,
	listDocuments,
	readDocument,
	removeDependencyMutation,
	removeTaskMutation,
	renameGroupMutation,
	setActualDatesMutation,
	setDependencyMutation,
	setEstimateMutation,
	setGroupParentMutation,
	setIssueLinksMutation,
	setKindMutation,
	setNotesMutation,
	setProgressMutation,
	setStatusMutation,
	setTaskNumberMutation,
	setTitleMutation,
	summarizeProject,
} from "#/lib/ai/tool-mutators";
import { withInputValidation } from "#/lib/ai/tool-validate";
import {
	addDependencyTool,
	addTaskTool,
	askChoiceTool,
	createBranchTool,
	createGroupTool,
	createWorkPlanTool,
	deleteGroupTool,
	getWorkPlanTool,
	listDocumentsTool,
	moveChatTool,
	moveTaskToGroupTool,
	proposeChangesTool,
	readDocumentTool,
	readProjectTool,
	removeDependencyTool,
	removeTaskTool,
	renameGroupTool,
	setActualDatesTool,
	setDependencyTool,
	setEstimateTool,
	setGroupParentTool,
	setIssueLinksTool,
	setKindTool,
	setNotesTool,
	setProgressTool,
	setStatusTool,
	setTaskNumberTool,
	setTitleTool,
	updateWorkPlanTool,
} from "#/lib/ai/tools";
import {
	createWorkPlanMutation,
	nextPendingStep,
	summarizeWorkPlan,
	updateWorkPlanMutation,
} from "#/lib/ai/work-plan-mutators";
import type { ChatDockPendingPrompt } from "#/lib/chat-dock";
import {
	chatDock,
	useChatDockMode,
	useChatDockPendingPrompt,
} from "#/lib/chat-dock";
import {
	type ChatBroadcast,
	type ChatBroadcaster,
	type ChatMessagesSnapshot,
	clearThreadMessages,
	createChatBroadcaster,
	DEFAULT_THREAD_TITLE,
	deriveThreadTitle,
	getScopeKey,
	moveThreadToScope,
	newThreadId,
	readThreadIndex,
	readThreadMessages,
	type ThreadIndex,
	type ThreadMeta,
	writeThreadIndex,
	writeThreadMessages,
} from "#/lib/chat-history";
import { changeWith } from "#/lib/pert/change-meta";
import type { ChangeFn } from "#/lib/pert/store";
import { projectDocStore } from "#/lib/pert/store";
import type { PertDoc } from "#/lib/pert/types";
import { useIsMobile } from "#/lib/use-media-query";
import { cn } from "#/lib/utils";
import type { ProjectView } from "#/routes/_app/p.$projectId";
import { forkProject, getProjectById } from "#/server/workspace";
import { ChatTabs } from "./chat-tabs";
import { UserMessage } from "./user-message";
import {
	CONTINUE_PLAN_MESSAGE,
	WorkPlanCard,
	WorkPlanStatusBar,
} from "./work-plan-card";

// Lazy-loaded so the chat-panel chunk stays free of the proposal/diff
// machinery. Keeps the storybook static build's chunk graph simple — the
// chat-panel chunk shouldn't inherit TLA from transitive deps that only the
// proposal card needs.
const ProposalCard = lazy(() =>
	import("./proposal-card").then((m) => ({ default: m.ProposalCard })),
);

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
// Store directly rather than via `useStore`. The chat is BOUND to the project
// it was opened with; tools only ever act on that project's doc. If the user
// navigated to a different project mid-conversation, the mutation is refused
// instead of silently landing on whichever doc happens to be active (which is
// how proposals from one chat used to end up inside another project).
function getBoundDoc(
	boundProjectId: string,
): { doc: PertDoc; changeDoc: ChangeFn } | { ok: false; error: string } {
	const { projectId, doc, changeDoc } = projectDocStore.state;
	if (!doc || !changeDoc) return noActiveProject;
	if (projectId !== boundProjectId) {
		return {
			ok: false as const,
			error:
				"This chat belongs to a different project than the one currently open. Ask the user to switch back to that project (or start a new chat here).",
		};
	}
	return { doc, changeDoc };
}

const noActiveProject = {
	ok: false as const,
	error: "No active project. Open one from the sidebar first.",
};

// Edit tools are blocked while a work plan awaits the user's approval. The
// plan approval IS the review gate for plan-and-execute mode — letting a
// model edit the doc before approval would defeat it.
const draftPlanGate = {
	ok: false as const,
	error:
		"A work plan is awaiting the user's approval. Do not make any edits until the user approves or rejects it on the plan card — you cannot approve it yourself. You may still revise the plan with update_work_plan.",
};

// Same as getBoundDoc, plus the draft-plan gate. Use for every tool that
// MUTATES the doc; read-only tools and the work-plan tools themselves use
// getBoundDoc directly.
function getEditableDoc(
	boundProjectId: string,
): { doc: PertDoc; changeDoc: ChangeFn } | { ok: false; error: string } {
	const active = getBoundDoc(boundProjectId);
	if ("error" in active) return active;
	if (active.doc.workPlan?.status === "draft") return draftPlanGate;
	return active;
}

// Writes doc changes attributed to the AI in the History drawer. Falls back
// to the untagged changeDoc when no handle is available (read-only paths).
function aiWrite(fallback: ChangeFn): ChangeFn {
	const handle = projectDocStore.state.handle;
	if (!handle) return fallback;
	return (fn) => changeWith(handle, "ai", fn);
}

// Auto-continue (Ralph loop) tuning. The cap bounds the number of LLM turns
// one approval can trigger unattended; the delay gives the user a beat to hit
// Stop/Cancel between turns.
const AUTO_CONTINUE_CAP = 15;
const AUTO_CONTINUE_DELAY_MS = 2000;

const autoContinueStorageKey = (projectId: string) =>
	`pertli.workPlanAutoContinue.${projectId}`;

function readAutoContinuePref(projectId: string): boolean {
	if (typeof window === "undefined") return false;
	try {
		return (
			window.localStorage.getItem(autoContinueStorageKey(projectId)) === "1"
		);
	} catch {
		return false;
	}
}

function writeAutoContinuePref(projectId: string, value: boolean): void {
	if (typeof window === "undefined") return;
	try {
		if (value) {
			window.localStorage.setItem(autoContinueStorageKey(projectId), "1");
		} else {
			window.localStorage.removeItem(autoContinueStorageKey(projectId));
		}
	} catch {
		// Storage unavailable — the toggle just won't persist across reloads.
	}
}

// Imperative API exposed by ChatThread so the outer panel can route dock
// pending prompts into the active thread without lifting useChat state up.
type ChatThreadAPI = {
	sendMessage(text: string): void;
	setInput(text: string): void;
};

// Routes a queued dock prompt (tutorial CTAs, "ask the assistant" shortcuts)
// into the active ChatThread. The tricky case is a freshly-created scope — e.g.
// navigating into a brand-new tutorial project — which arrives with no active
// thread, hence no ChatThread mounted and no API to send through. We must NOT
// consume (clear) the prompt until we actually have an API, or it's lost: create
// a thread first and let the effect re-run once `activeThreadId` fills in (by
// which point ChatThread has mounted and registered its API, since child mount
// effects run before this parent effect). Extracted from the panel so the
// empty-scope path is unit-testable without mounting the whole panel.
export function usePendingPromptDispatch(params: {
	pending: ChatDockPendingPrompt | null;
	activeThreadId: string | null;
	apiRef: { readonly current: ChatThreadAPI | null };
	onCreateThread: () => void;
}): void {
	const { pending, activeThreadId, apiRef, onCreateThread } = params;
	useEffect(() => {
		if (!pending) return;
		if (!activeThreadId) {
			onCreateThread();
			return; // don't consume yet — re-runs when activeThreadId fills in
		}
		const api = apiRef.current;
		// API not yet registered. This is effectively unreachable while
		// `activeThreadId` is truthy — ChatThread mounts in the same commit that
		// sets it, and React runs child effects (its `registerAPI`) before this
		// parent effect — but bail defensively rather than dereference null. The
		// effect re-runs whenever `activeThreadId`/`pending` change.
		if (!api) return;
		// Consume only once we have an API, and act on the store's returned value
		// rather than the closed-over `pending`. That makes this idempotent: a
		// repeat invocation for the same commit (e.g. a StrictMode double-mount)
		// gets null back and no-ops instead of sending the prompt twice.
		const prompt = chatDock.consumePendingPrompt();
		if (!prompt) return;
		if (prompt.autoSend) {
			api.sendMessage(prompt.text);
		} else {
			api.setInput(prompt.text);
		}
	}, [pending, activeThreadId, apiRef, onCreateThread]);
}

export function ChatPanel({
	className,
	endpoint = "/api/chat",
	initialPrompt,
	autoSendInitial = false,
	showDockControls = false,
}: ChatPanelProps) {
	// Chat scoping follows the URL, not the Automerge doc. Reading from
	// `projectDocStore.projectId` would stall the panel on the no-project
	// state until the doc materialises — that race shows up in e2e where
	// sync is disabled and on slow networks for real users. The doc-store
	// value still wins when the URL has no projectId (Storybook seeds it,
	// share-link routes don't carry one).
	const routeParams = useParams({ strict: false }) as { projectId?: string };
	const docStoreProjectId = useStore(projectDocStore, (s) => s.projectId);
	const projectId = routeParams.projectId ?? docStoreProjectId;
	const scopeKey = getScopeKey(projectId);

	if (scopeKey === null || !projectId) {
		return (
			<NoProjectChat
				className={className}
				showDockControls={showDockControls}
			/>
		);
	}
	return (
		<BoundChatPanel
			className={className}
			endpoint={endpoint}
			initialPrompt={initialPrompt}
			autoSendInitial={autoSendInitial}
			showDockControls={showDockControls}
			scopeKey={scopeKey}
			projectId={projectId}
		/>
	);
}

// The chat is bound to a project — without one there's no thread index to
// load, the AI's tools all fail (`No active project`), and the conversation
// would have nowhere to live. Render a small explainer in place of the panel
// instead of letting the user start a thread that will be wiped when they
// open a project.
function NoProjectChat({
	className,
	showDockControls,
}: {
	className?: string;
	showDockControls: boolean;
}) {
	return (
		<div
			data-testid="chat-panel"
			data-state="no-project"
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
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
				<p className="text-sm font-medium">No project open</p>
				<p className="max-w-xs text-xs text-muted-foreground">
					The assistant works against the active plan — open a project from the
					sidebar to start a chat about it.
				</p>
			</div>
		</div>
	);
}

type BoundChatPanelProps = ChatPanelProps & {
	scopeKey: string;
	// The project this chat panel (and every tool it executes) is bound to.
	projectId: string;
};

function BoundChatPanel({
	className,
	endpoint = "/api/chat",
	initialPrompt,
	autoSendInitial = false,
	showDockControls = false,
	scopeKey,
	projectId,
}: BoundChatPanelProps) {
	// Thread index for the current scope. Read from localStorage on first
	// access; re-read whenever the scope changes (e.g. user opens a different
	// project). An empty scope is legitimate — `readThreadIndex` never auto-seeds
	// a thread, so a brand-new project yields `activeThreadId: null` and the
	// panel renders its empty state until a thread is created.
	const [index, setIndex] = useState<ThreadIndex>(() =>
		readThreadIndex(scopeKey),
	);
	useEffect(() => {
		setIndex(readThreadIndex(scopeKey));
	}, [scopeKey]);

	const activeThreadId = index.activeThreadId;
	// Title of the project this chat is bound to, surfaced in the header so the
	// chat ↔ project connection is visible. Sourced from the same cached
	// `["project", id]` record the sidebar uses (loads reliably and is the
	// canonical display name) rather than the Automerge doc, whose title only
	// arrives once sync delivers the document. Header falls back to the bare
	// "Chat" label until the record resolves.
	const { data: project } = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => getProjectById({ data: { projectId } }),
		staleTime: 30_000,
	});
	const projectTitle = project?.title ?? null;
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
			const newId = newThreadId();
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
			// Bail if the thread is already gone from the latest index — it can be
			// removed underneath us via cross-tab sync between hover and click, and
			// we must not wipe a transcript for a thread this close didn't remove.
			if (!index.threads.some((t) => t.id === id)) return;
			updateIndex((prev) => {
				const idx = prev.threads.findIndex((t) => t.id === id);
				if (idx < 0) return prev;
				const nextThreads = prev.threads.filter((t) => t.id !== id);
				// Dropping the last thread leaves the scope empty — activeThreadId
				// goes null and the panel renders its empty state.
				let nextActive = prev.activeThreadId;
				if (prev.activeThreadId === id) {
					const neighbor =
						nextThreads[idx] ?? nextThreads[idx - 1] ?? nextThreads[0];
					nextActive = neighbor?.id ?? null;
				}
				return { activeThreadId: nextActive, threads: nextThreads };
			});
			// The thread is gone for good — drop its transcript too so it doesn't
			// linger in localStorage.
			clearThreadMessages(id);
			messageCountsRef.current.delete(id);
		},
		[index, updateIndex],
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

	// --- Branch / move-chat support -----------------------------------------
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// The active thread id, readable from inside tool handlers without making
	// the tools array depend on it (tab switches must not re-create the tools
	// — useChat would drop the conversation).
	const activeThreadIdRef = useRef(activeThreadId);
	activeThreadIdRef.current = activeThreadId;

	// A chat move requested by the move_chat_to_project tool. Executed only
	// after the current stream settles so the assistant's closing message
	// isn't cut off when the panel remounts under the target project.
	const pendingChatMoveRef = useRef<{
		targetProjectId: string;
		threadId: string;
	} | null>(null);

	const flushPendingChatMove = useCallback(() => {
		const pending = pendingChatMoveRef.current;
		if (!pending) return;
		pendingChatMoveRef.current = null;
		const targetScopeKey = getScopeKey(pending.targetProjectId);
		if (targetScopeKey) {
			moveThreadToScope(pending.threadId, scopeKey, targetScopeKey);
		}
		void navigate({
			to: "/p/$projectId",
			params: { projectId: pending.targetProjectId },
		});
	}, [navigate, scopeKey]);

	// --- Work-plan auto-continue (Ralph loop) preference ---------------------
	// The toggle is a per-project UI preference; the loop itself runs inside
	// ChatThread (which owns sendMessage / isLoading).
	const [autoContinue, setAutoContinue] = useState(() =>
		readAutoContinuePref(projectId),
	);
	useEffect(() => {
		setAutoContinue(readAutoContinuePref(projectId));
	}, [projectId]);
	const onToggleAutoContinue = useCallback(
		(next: boolean) => {
			setAutoContinue(next);
			writeAutoContinuePref(projectId, next);
		},
		[projectId],
	);

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

	// Tools are stable for as long as the panel stays bound to one project —
	// useChat re-creates the underlying client on identity changes, which
	// would drop the chat. When projectId changes the thread remounts anyway
	// (its key is the new scope's activeThreadId), so the identity change is
	// invisible to useChat.
	const tools = useMemo(
		() =>
			[
				readProjectTool.client(() => {
					// Read-only: allowed even while a draft plan awaits approval.
					const active = getBoundDoc(projectId);
					if ("error" in active) return active;
					return summarizeProject(active.doc);
				}),
				listDocumentsTool.client(() => {
					// Read-only.
					const active = getBoundDoc(projectId);
					if ("error" in active) return active;
					return listDocuments(active.doc);
				}),
				readDocumentTool.client((args) => {
					// Read-only.
					const active = getBoundDoc(projectId);
					if ("error" in active) return active;
					return readDocument(active.doc, args);
				}),
				addTaskTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					// Surfaces validation failures (unknown parent container, id
					// collision) back to the model instead of silently corrupting
					// the doc.
					let result: ReturnType<typeof addTaskMutation> = { id: "" };
					active.changeDoc((d) => {
						result = addTaskMutation(d, args);
					});
					return result;
				}),
				setEstimateTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setEstimateMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setEstimateMutation(d, args);
					});
					return result;
				}),
				setTitleTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setTitleMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setTitleMutation(d, args);
					});
					return result;
				}),
				addDependencyTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof addDependencyMutation> = { id: "" };
					active.changeDoc((d) => {
						result = addDependencyMutation(d, args);
					});
					return result;
				}),
				removeDependencyTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof removeDependencyMutation> = {
						ok: true,
					};
					active.changeDoc((d) => {
						result = removeDependencyMutation(d, args);
					});
					return result;
				}),
				removeTaskTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof removeTaskMutation> = { ok: true };
					active.changeDoc((d) => {
						result = removeTaskMutation(d, args);
					});
					return result;
				}),
				setKindTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setKindMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setKindMutation(d, args);
					});
					return result;
				}),
				setTaskNumberTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setTaskNumberMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setTaskNumberMutation(d, args);
					});
					return result;
				}),
				setNotesTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setNotesMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setNotesMutation(d, args);
					});
					return result;
				}),
				setIssueLinksTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setIssueLinksMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setIssueLinksMutation(d, args);
					});
					return result;
				}),
				moveTaskToGroupTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof assignTaskToGroupMutation> = {
						ok: true,
					};
					active.changeDoc((d) => {
						result = assignTaskToGroupMutation(d, args);
					});
					return result;
				}),
				setStatusTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setStatusMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setStatusMutation(d, args);
					});
					return result;
				}),
				setProgressTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setProgressMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setProgressMutation(d, args);
					});
					return result;
				}),
				setActualDatesTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setActualDatesMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setActualDatesMutation(d, args);
					});
					return result;
				}),
				setDependencyTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setDependencyMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setDependencyMutation(d, args);
					});
					return result;
				}),
				createGroupTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let createdId: string | null = null;
					let error = "no active project";
					active.changeDoc((d) => {
						const r = createGroupMutation(d, args);
						if (r.ok) createdId = r.id;
						else error = r.error;
					});
					return createdId !== null
						? { id: createdId }
						: { ok: false as const, error };
				}),
				renameGroupTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof renameGroupMutation> = { ok: true };
					active.changeDoc((d) => {
						result = renameGroupMutation(d, args);
					});
					return result;
				}),
				setGroupParentTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof setGroupParentMutation> = { ok: true };
					active.changeDoc((d) => {
						result = setGroupParentMutation(d, args);
					});
					return result;
				}),
				deleteGroupTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof deleteGroupMutation> = {
						ok: true,
						promotedTasks: 0,
						promotedGroups: 0,
					};
					active.changeDoc((d) => {
						result = deleteGroupMutation(d, args);
					});
					return result.ok ? { ok: true as const } : result;
				}),
				// Branching: forks the bound project via the same server fn as the
				// "Branch this plan" dialog. Auth/membership checks happen there.
				createBranchTool.client(async (args) => {
					try {
						const result = await forkProject({
							data: {
								parentProjectId: projectId,
								title: args.title,
								description: args.description ?? null,
							},
						});
						// The sidebar's project list is cached under ["projects"].
						void queryClient.invalidateQueries({ queryKey: ["projects"] });
						return {
							ok: true as const,
							projectId: result.id,
							title: args.title,
						};
					} catch (e) {
						return {
							ok: false as const,
							error:
								e instanceof Error ? e.message : "Could not create the branch",
						};
					}
				}),
				// Moving the conversation: validate the target, then queue the move.
				// The actual localStorage re-scope + navigation runs when the stream
				// settles (see flushPendingChatMove / onStreamSettled).
				moveChatTool.client(async (args) => {
					try {
						await getProjectById({ data: { projectId: args.projectId } });
					} catch (e) {
						return {
							ok: false as const,
							error:
								e instanceof Error
									? e.message
									: "Target project not found or not accessible",
						};
					}
					const threadId = activeThreadIdRef.current;
					if (!threadId) {
						return { ok: false as const, error: "No active chat to move" };
					}
					pendingChatMoveRef.current = {
						targetProjectId: args.projectId,
						threadId,
					};
					return { ok: true as const, willNavigate: true };
				}),
				// ask_choice is pure UI — acknowledge immediately so the model loop
				// continues. The chips themselves are rendered below from the message
				// log; clicking one sends the option's value as a normal user message.
				askChoiceTool.client(() => ({ ok: true as const })),
				// propose_changes builds a staged proposal in the client store and
				// returns its id. The live doc is NOT mutated — the chat UI renders
				// a ProposalCard with the diff, and the user clicks Apply (or per-
				// row Apply, or Reject) to commit.
				proposeChangesTool.client((args) => {
					const active = getEditableDoc(projectId);
					if ("error" in active) return active;
					// stageProposal refuses (ok:false) when no operation could be
					// staged — empty proposals never render a card, and the model
					// gets an explicit failure instead of a hollow success.
					const staged = stageProposal(
						active.doc,
						args.rationale,
						args.operations as EditOp[],
						projectId,
					);
					if (!staged.ok) return staged;
					// Plan-and-execute mode: once the user has APPROVED a work plan,
					// step changes apply directly — the plan approval was the review.
					// The proposal still goes through the full staging machinery
					// (validation, id remapping, failure feedback), it just doesn't
					// wait for a click.
					const planStatus = active.doc.workPlan?.status;
					if (planStatus === "approved" || planStatus === "executing") {
						const applyResults = applyProposal(
							staged.proposal.id,
							aiWrite(active.changeDoc),
						);
						const applyFailures = applyResults.flatMap((r) =>
							r.ok ? [] : [{ op: r.op, error: r.error }],
						);
						return {
							ok: true as const,
							proposalId: staged.proposal.id,
							autoApplied: true,
							summary: staged.summary,
							applyFailures,
						};
					}
					return {
						ok: true as const,
						proposalId: staged.proposal.id,
						summary: staged.summary,
					};
				}),
				// ── Work plan tools (plan-and-execute mode) ──────────────────────
				createWorkPlanTool.client((args) => {
					// Not gated by getEditableDoc: creating/revising the PLAN is how
					// the draft state comes to exist in the first place.
					const active = getBoundDoc(projectId);
					if ("error" in active) return active;
					let result:
						| { ok: true; planId: string }
						| { ok: false; error: string } = {
						ok: false,
						error: "plan was not created",
					};
					aiWrite(active.changeDoc)((d) => {
						const created = createWorkPlanMutation(d, args);
						result =
							"planId" in created
								? { ok: true as const, planId: created.planId }
								: created;
					});
					return result;
				}),
				updateWorkPlanTool.client((args) => {
					const active = getBoundDoc(projectId);
					if ("error" in active) return active;
					let result: ReturnType<typeof updateWorkPlanMutation> = {
						ok: false,
						error: "plan was not updated",
					};
					aiWrite(active.changeDoc)((d) => {
						result = updateWorkPlanMutation(d, args);
					});
					return result;
				}),
				getWorkPlanTool.client(() => {
					const active = getBoundDoc(projectId);
					if ("error" in active) return active;
					const plan = active.doc.workPlan;
					if (!plan) {
						return {
							ok: false as const,
							error:
								"No work plan exists for this project. Create one with create_work_plan.",
						};
					}
					return { ok: true as const, plan: summarizeWorkPlan(plan) };
				}),
			]
				// Validate each tool's args against its own inputSchema before the
				// handler runs (the @tanstack/ai client path doesn't). propose_changes
				// is exempt: a strict whole-batch parse would reject the entire
				// proposal on a single bad op, defeating its per-op tolerance — that
				// validation lives in applyOperations instead, shared with the diff
				// preview and the manual Apply path.
				.map((tool) =>
					tool.name === proposeChangesTool.name
						? tool
						: withInputValidation(tool),
				)
				// Every executor gets logging + throw containment (see tool-log.ts):
				// calls/results/errors land in the devtools console and in
				// window.__pertliToolLog, and a handler exception becomes an
				// ok:false result instead of killing the whole chat run.
				.map(withToolLogging),
		// queryClient is referentially stable; projectId is the only value that
		// actually changes tool identity (and the thread remounts with it).
		[projectId, queryClient],
	);

	// Imperative handle into the active ChatThread; used by the dock pending-
	// prompt effect below. ChatThread reports its API on mount via the
	// registerAPI prop and tears it down on unmount.
	const threadApiRef = useRef<ChatThreadAPI | null>(null);
	const registerThreadAPI = useCallback((api: ChatThreadAPI | null) => {
		threadApiRef.current = api;
	}, []);

	const dockPending = useChatDockPendingPrompt();
	usePendingPromptDispatch({
		pending: dockPending,
		activeThreadId,
		apiRef: threadApiRef,
		onCreateThread,
	});

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
				{projectTitle && (
					<div
						className="min-w-0 truncate text-xs text-muted-foreground"
						title={projectTitle}
						data-testid="chat-project-title"
					>
						· {projectTitle}
					</div>
				)}
				<div className="ml-auto flex items-center gap-1">
					{showDockControls && <ChatDockControls />}
				</div>
			</header>
			{/* No tab strip in the empty state — a tablist with zero tabs is an
			    a11y mismatch, and the empty-state CTA below is the sole way in. */}
			{index.threads.length > 0 && (
				<ChatTabs
					threads={index.threads}
					activeThreadId={activeThreadId ?? ""}
					onSelect={onSelectThread}
					onCreate={onCreateThread}
					onClose={onCloseThread}
					onRename={onRenameThread}
					isThreadEmpty={isThreadEmpty}
				/>
			)}
			{activeThreadId ? (
				<ChatThread
					// Keyed by scope AND thread: moving a thread to another project (same
					// threadId, new scope) must remount it so useChat re-initialises from
					// the persisted transcript with tools bound to the new project.
					key={`${scopeKey}:${activeThreadId}`}
					threadId={activeThreadId}
					scopeKey={scopeKey}
					endpoint={endpoint}
					initialPrompt={initialPrompt}
					autoSendInitial={autoSendInitial}
					tools={tools}
					broadcaster={broadcasterRef.current}
					registerAPI={registerThreadAPI}
					onAutoTitle={(derived) => onAutoTitle(activeThreadId, derived)}
					onMessagesChanged={(count) =>
						onMessagesChanged(activeThreadId, count)
					}
					onStreamSettled={flushPendingChatMove}
					planLoop={{ autoContinue, onToggleAutoContinue }}
				/>
			) : (
				<div
					data-testid="chat-empty"
					className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
				>
					<p className="text-sm font-medium">No chat yet</p>
					<p className="max-w-xs text-xs text-muted-foreground">
						Start a new chat to talk to the assistant about this project.
					</p>
					<Button
						type="button"
						size="sm"
						onClick={onCreateThread}
						data-testid="chat-empty-new"
					>
						<PlusIcon className="size-3.5" />
						New chat
					</Button>
				</div>
			)}
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
	// Called when a stream that actually ran has finished. The parent uses
	// this to run deferred actions like moving the chat to a freshly created
	// branch — anything that would disrupt an in-flight response.
	onStreamSettled?(): void;
	// Work-plan execution loop controls (plan-and-execute mode). When set, the
	// thread renders the WorkPlanStatusBar above the input and drives the
	// auto-continue loop.
	planLoop?: {
		autoContinue: boolean;
		onToggleAutoContinue: (next: boolean) => void;
	};
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
	onStreamSettled,
	planLoop,
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

	// Deferred-action hook + work-plan auto-continue. Declared after the
	// persistence effect above so the transcript is written to localStorage
	// before anything disruptive runs (navigation, the next loop turn).
	//
	// `hasStreamedRef` makes both behaviours fire only after a stream actually
	// ran in this mount — never on mount itself. (Without it, reloading a page
	// mid-plan with auto-continue enabled would immediately fire an LLM call,
	// which is too surprising; the user clicks Continue once to resume.)
	const hasStreamedRef = useRef(false);
	const autoContinueCountRef = useRef(0);
	// Reactive mirror of the loop counter so the status bar can show progress
	// toward the runaway-loop cap (e.g. "Auto 3/15"). The ref stays the source
	// of truth for the loop effect; this just makes the value renderable.
	const [autoTurns, setAutoTurns] = useState(0);
	useEffect(() => {
		if (isLoading) {
			hasStreamedRef.current = true;
			return;
		}
		if (!hasStreamedRef.current) return;
		onStreamSettled?.();

		// --- Auto-continue (Ralph loop) ---------------------------------------
		if (!planLoop?.autoContinue) return;
		// Never loop on an errored turn — that's how runaway loops happen.
		if (error) return;
		const plan = projectDocStore.state.doc?.workPlan;
		if (!plan) return;
		if (plan.status !== "approved" && plan.status !== "executing") return;
		// A failed step pauses the loop; the user reviews and continues manually.
		if (plan.steps.some((s) => s.status === "failed")) return;
		if (!nextPendingStep(plan)) return;
		if (autoContinueCountRef.current >= AUTO_CONTINUE_CAP) return;
		autoContinueCountRef.current += 1;
		setAutoTurns(autoContinueCountRef.current);
		const timer = window.setTimeout(() => {
			// Re-check at fire time — the user may have cancelled the plan or
			// switched auto-continue off during the delay.
			const current = projectDocStore.state.doc?.workPlan;
			if (!current) return;
			if (current.status !== "approved" && current.status !== "executing")
				return;
			void sendMessage(CONTINUE_PLAN_MESSAGE);
		}, AUTO_CONTINUE_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [isLoading, onStreamSettled, planLoop?.autoContinue, error, sendMessage]);

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
	const {
		attachments,
		attachmentsBusy,
		ingestFiles,
		removeAttachment,
		clearAttachments,
	} = useFileAttachments();
	const [isDragging, setIsDragging] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
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
		const ready = attachments.filter(isReadyAttachment);
		if (!trimmed && ready.length === 0) return;
		if (isLoading || attachmentsBusy) return;
		// Attachment-free is the common path; keep it synchronous. Attachments
		// require the file-extract module (dynamic-imported to keep this chunk
		// free of pdfjs/mammoth's top-level await).
		if (ready.length === 0) {
			setInput("");
			void sendMessage(trimmed);
			return;
		}
		setInput("");
		clearAttachments();
		void (async () => {
			const { buildMessageWithAttachments } = await import(
				"#/lib/ai/file-extract"
			);
			const composed = buildMessageWithAttachments(
				trimmed,
				ready.map((a) => a.extracted),
			);
			void sendMessage(composed);
		})();
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
						onClick={() => {
							stop();
							// Stopping a stream also pauses the work-plan auto-continue
							// loop — otherwise the loop would immediately fire the next
							// turn the user just tried to halt.
							planLoop?.onToggleAutoContinue(false);
						}}
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
					{isLoading &&
						(messages as unknown as ChatMessage[]).at(-1)?.role !==
							"assistant" && <ThinkingIndicator />}
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
			{planLoop && (
				// Persistent work-plan strip: progress + Continue + Auto + Cancel.
				// Lives above the input so it never scrolls away with the messages.
				<WorkPlanStatusBar
					onContinue={(msg) => {
						// A manual Continue resets the runaway-loop cap.
						autoContinueCountRef.current = 0;
						setAutoTurns(0);
						void sendMessage(msg);
					}}
					autoContinue={planLoop.autoContinue}
					onToggleAutoContinue={(next) => {
						if (next) {
							autoContinueCountRef.current = 0;
							setAutoTurns(0);
						}
						planLoop.onToggleAutoContinue(next);
					}}
					autoTurns={autoTurns}
					autoCap={AUTO_CONTINUE_CAP}
					busy={isLoading}
				/>
			)}
			<fieldset
				className={cn(
					"relative shrink-0 border-t border-x-0 border-b-0 p-2",
					isDragging && "bg-primary/5",
				)}
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
					// Only flip off when the pointer leaves the container, not when
					// it moves between children.
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
					ingestFiles(e.dataTransfer.files);
				}}
			>
				{attachments.length > 0 && (
					<div
						className="mb-1.5 flex flex-wrap gap-1"
						data-testid="chat-attachments"
					>
						{attachments.map((a) => (
							<AttachmentChip
								key={a.id}
								slot={a}
								testIdPrefix="chat-attachment"
								onRemove={() => removeAttachment(a.id)}
							/>
						))}
					</div>
				)}
				{isDragging && (
					<div
						className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-md border-2 border-dashed border-primary/60 bg-background/80 text-[11px] font-medium text-primary"
						data-testid="chat-drop-overlay"
					>
						Drop files to attach
					</div>
				)}
				<div className="flex items-end gap-2">
					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="hidden"
						accept=".txt,.md,.markdown,.csv,.json,.log,.rst,.yaml,.yml,.pdf,.docx,text/*,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
						onChange={(e) => {
							if (e.target.files) ingestFiles(e.target.files);
							e.target.value = "";
						}}
						data-testid="chat-file-input"
					/>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-9 shrink-0"
						onClick={() => fileInputRef.current?.click()}
						disabled={isLoading}
						aria-label="Attach files"
						data-testid="chat-attach"
					>
						<PaperclipIcon className="size-4" />
					</Button>
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
								: attachmentsBusy
									? "Reading attachments…"
									: "Message — Enter to send, Shift-Enter for newline. Drag files to attach."
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
						disabled={
							isLoading ||
							attachmentsBusy ||
							(!input.trim() && !attachments.some((a) => a.status === "ready"))
						}
						aria-label="Send message"
						data-testid="chat-send"
					>
						<ArrowUpIcon className="size-4" />
					</Button>
				</div>
			</fieldset>
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

// Shown while the assistant is working but hasn't produced visible output yet
// (initial latency, or running tools before any text streams). Gives a clear
// "something is happening" signal beyond the Stop button. Once assistant text
// starts streaming via Streamdown, the last message becomes role="assistant"
// and this disappears.
function ThinkingIndicator() {
	return (
		<div
			className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground"
			data-testid="chat-thinking"
			aria-live="polite"
		>
			<span className="flex gap-1">
				<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
				<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
				<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
			</span>
			Thinking…
		</div>
	);
}

function EmptyState({ onSeed }: { onSeed: (text: string) => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-5 p-4 text-center">
			<p className="max-w-sm text-sm text-muted-foreground">
				Ask anything about your project — the assistant can answer questions and
				make changes for you. Try one of these:
			</p>
			<SeedGroup label="Do something" seeds={ACTION_SEEDS} onSeed={onSeed} />
			<SeedGroup label="Learn PERT" seeds={TUTORIAL_SEEDS} onSeed={onSeed} />
		</div>
	);
}

function SeedGroup({
	label,
	seeds,
	onSeed,
}: {
	label: string;
	seeds: ReadonlyArray<{ label: string; prompt: string }>;
	onSeed: (text: string) => void;
}) {
	return (
		<div className="w-full max-w-sm space-y-1.5">
			<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
				{label}
			</p>
			<div className="flex flex-wrap justify-center gap-1.5">
				{seeds.map((seed) => (
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
	const text = extractMessageText(message);
	const toolCalls = extractToolCalls(message);
	const proposalIds = extractProposalIds(message);
	const workPlanIds = extractWorkPlanIds(message);
	const hasText = text.length > 0;
	const hasTools = toolCalls.length > 0;
	const hasProposals = proposalIds.length > 0;
	const hasWorkPlans = workPlanIds.length > 0;
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
						// Splits attached-file blocks into compact expandable chips so a
						// dropped PDF doesn't dump its full text into the bubble.
						<UserMessage text={text} />
					) : (
						<div className="prose prose-xs prose-zinc dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_pre]:text-[10px] [&_code]:text-[10px]">
							<Streamdown parseIncompleteMarkdown>{text}</Streamdown>
						</div>
					)
				) : !hasTools && !hasProposals && !hasWorkPlans ? (
					<span className="italic text-muted-foreground">…thinking…</span>
				) : null}
				{hasWorkPlans && (
					<div className="flex flex-col gap-1.5">
						{workPlanIds.map((id) => (
							<WorkPlanCard key={id} planId={id} />
						))}
					</div>
				)}
				{hasProposals && (
					<div className="flex flex-col gap-1.5">
						{proposalIds.map((id) => (
							<Suspense
								key={id}
								fallback={
									<div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
										Loading proposal…
									</div>
								}
							>
								<ProposalCard proposalId={id} />
							</Suspense>
						))}
					</div>
				)}
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
			{failed && (
				<div
					className="border-t border-destructive/30 px-1.5 py-1 text-[10px] text-destructive"
					data-testid={`chat-tool-error-${call.name}`}
				>
					{formatToolError(result?.error ?? result?.content)}
				</div>
			)}
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

function extractMessageText(message: ChatMessage): string {
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
			// chat scroller. `propose_changes` is rendered as a ProposalCard and
			// `create_work_plan` as a WorkPlanCard in-bubble instead of as wrench
			// chips. All would be redundant alongside their custom surfaces.
			.filter(
				(c) =>
					c.name !== "ask_choice" &&
					c.name !== "propose_changes" &&
					c.name !== "create_work_plan",
			)
	);
}

// Pull proposal ids out of any `propose_changes` tool-results on the message.
// Used by MessageRow to render an inline ProposalCard under the assistant's
// text. We read the result (not the call args) so the card only shows up
// after the client handler has actually staged the proposal.
function extractProposalIds(message: ChatMessage): string[] {
	const ids: string[] = [];
	for (const part of message.parts) {
		if (part.type !== "tool-result") continue;
		const content = typeof part.content === "string" ? part.content : "";
		if (!content) continue;
		try {
			const parsed = JSON.parse(content) as { proposalId?: unknown };
			if (typeof parsed.proposalId === "string" && parsed.proposalId) {
				ids.push(parsed.proposalId);
			}
		} catch {
			// not JSON; ignore.
		}
	}
	return ids;
}

// Same idea for `create_work_plan` results: a `planId` field in a tool result
// renders an inline WorkPlanCard (the plan-and-execute mode's review surface).
function extractWorkPlanIds(message: ChatMessage): string[] {
	const ids: string[] = [];
	for (const part of message.parts) {
		if (part.type !== "tool-result") continue;
		const content = typeof part.content === "string" ? part.content : "";
		if (!content) continue;
		try {
			const parsed = JSON.parse(content) as { planId?: unknown };
			if (typeof parsed.planId === "string" && parsed.planId) {
				ids.push(parsed.planId);
			}
		} catch {
			// not JSON; ignore.
		}
	}
	return ids;
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

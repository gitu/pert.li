import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	CircleDotIcon,
	EyeIcon,
	FolderTreeIcon,
	HistoryIcon,
	LaptopIcon,
	LayersIcon,
	LogOutIcon,
	MoonIcon,
	PencilIcon,
	PlusIcon,
	ShieldIcon,
	SunIcon,
	UserCogIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ProfileDialog } from "#/components/account/profile-dialog";
import { SyncNowItem } from "#/components/account/sync-now-item";
import { UserAvatar } from "#/components/account/user-avatar";
import { ChatPanel } from "#/components/ai/chat-panel";
import { MobileBottomNav } from "#/components/app-shell/mobile-bottom-nav";
import { MobileProjectsSheet } from "#/components/app-shell/mobile-projects-sheet";
import { MobileTopBar } from "#/components/app-shell/mobile-top-bar";
import { HistoryDrawer } from "#/components/pert/history/history-drawer";
import { TaskInspector } from "#/components/pert/inspector/task-inspector";
import { SyncStatus } from "#/components/sync/sync-status";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "#/components/ui/resizable";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Separator } from "#/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import { Toaster } from "#/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { TooltipProvider } from "#/components/ui/tooltip";
import { CreateProjectDialog } from "#/components/workspace/create-project-dialog";
import { ProjectList } from "#/components/workspace/project-list";
import { WorkspaceSwitcher } from "#/components/workspace/workspace-switcher";
import { useActiveWorkspaceId } from "#/lib/active-workspace";
import { useOfflineSession } from "#/lib/auth/offline-session";
import { signOutEverywhere } from "#/lib/auth/sign-out";
import { RepoProvider } from "#/lib/automerge/provider";
import { chatDock, useChatDockMode } from "#/lib/chat-dock";
import { QueryPersistGate } from "#/lib/query/persist-gate";
import { useMergedProjects } from "#/lib/sync/merge-projects";
import { useReconciler } from "#/lib/sync/use-reconciler";
import { setThemeMode, type ThemeMode, useThemeMode } from "#/lib/theme";
import { useIsMobile } from "#/lib/use-media-query";
import { ViewModeProvider } from "#/lib/view-mode";
import { hasSeenWelcome } from "#/lib/welcome";
import { listProjects } from "#/server/workspace.ts";

// Auth-gated shell: session is resolved client-side via useOfflineSession
// (which layers a cached identity over Better Auth's useSession for offline),
// so an SSR render only ever produces the "Loading…" placeholder before
// hydration anyway. The leaves under this route (project canvas with
// xyflow/ELK/automerge, admin) are also pure client surfaces with no SEO
// value. Skipping SSR here drops the wasted server render of the heavy
// project bundle and ships the shell straight to hydration. Public routes
// (/welcome, /signin, /share/$token, /join/$token, /privacy) live outside
// this layout and continue to SSR.
export const Route = createFileRoute("/_app")({
	ssr: false,
	component: AppShell,
});

// Thin wrapper so the entire authed shell (including its loading/redirect
// states) sits under the Query persistence provider — that's what makes the
// project list and project→docUrl lookups render from IndexedDB while offline.
function AppShell() {
	const { queryClient } = Route.useRouteContext();
	return (
		<QueryPersistGate client={queryClient}>
			<AppShellInner />
		</QueryPersistGate>
	);
}

function AppShellInner() {
	const navigate = useNavigate();
	// Offline-tolerant session: a previously-authenticated user keeps a cached
	// identity so the shell still unlocks (read/edit local docs) when the live
	// /api/auth check can't reach the server. Server fns remain cookie-gated.
	const {
		data: session,
		isPending,
		source: sessionSource,
	} = useOfflineSession();
	const [createOpen, setCreateOpen] = useState(false);
	const [profileOpen, setProfileOpen] = useState(false);
	const [mobileProjectsOpen, setMobileProjectsOpen] = useState(false);
	const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
	// First time the session loads without a name we prompt the user — but only
	// once, so dismissing the dialog (or saving anything) doesn't immediately
	// re-open it on the next re-render.
	const promptedNameRef = useRef(false);
	const sessionName = session?.user?.name?.trim() ?? "";
	useEffect(() => {
		if (session?.user && !sessionName && !promptedNameRef.current) {
			promptedNameRef.current = true;
			setProfileOpen(true);
		}
	}, [session?.user, sessionName]);
	const isMobile = useIsMobile();
	const dockMode = useChatDockMode();
	const pinnedChat = dockMode === "pinned" && !isMobile;
	// Singleton chat: ChatPanel mounts once below the layout and createPortal
	// teleports its DOM between the Sheet body, the pinned column, or a hidden
	// fallback host depending on dock mode. Same React instance → useChat
	// state persists across mode flips (no more conversation wipe when the
	// user toggles pin). Slots live in this outer component so a viewport
	// flip (e.g. tablet rotation) doesn't unmount the chat.
	const [sheetSlot, setSheetSlot] = useState<HTMLDivElement | null>(null);
	const [pinnedSlot, setPinnedSlot] = useState<HTMLDivElement | null>(null);
	const [fallbackSlot, setFallbackSlot] = useState<HTMLDivElement | null>(null);
	// During a mode flip (e.g. sheet→pinned) the new slot's ref callback hasn't
	// fired yet for one render, so the "active" target is briefly null. Fall
	// back to the hidden host in that window so ChatPanel never unmounts —
	// otherwise useChat would lose its messages mid-transition.
	const activeChatTarget = pinnedChat
		? pinnedSlot
		: dockMode === "sheet"
			? sheetSlot
			: null;
	const chatTarget = activeChatTarget ?? fallbackSlot;
	const leafParams = useParams({ strict: false }) as { projectId?: string };
	const inProject = Boolean(leafParams.projectId);

	useEffect(() => {
		// Only bounce to signin/welcome when we're online and genuinely have no
		// session ("none"). Offline with a cached identity ("offline") keeps the
		// shell; an in-flight check ("pending") just shows the loader.
		if (sessionSource === "none") {
			// First-time visitors get the marketing page; returning ones (who
			// already saw it and either signed in or bounced) go straight to the
			// sign-in form so we don't make them re-scroll the pitch.
			navigate({ to: hasSeenWelcome() ? "/signin" : "/welcome" });
		}
	}, [sessionSource, navigate]);

	if (isPending || !session) {
		return (
			<div className="grid min-h-svh place-items-center text-sm text-muted-foreground">
				Loading…
			</div>
		);
	}

	// `isAdmin` is exposed via Better Auth's additionalFields config but isn't
	// part of the base typed user shape. Read it defensively and pass an
	// extended user object down to the shells so the topbar can show the
	// admin nav entry only when the bit is set.
	const sessionUser = session.user as { isAdmin?: unknown };
	const shellUser = {
		name: session.user.name,
		email: session.user.email,
		image: session.user.image,
		isAdmin: sessionUser.isAdmin === true,
	};

	return (
		<ViewModeProvider>
			<RepoProvider>
				{/* Mounted inside RepoProvider so the reconcile loop can nudge the
				    browser repo to re-announce freshly-registered docs. */}
				<ReconcilerMount />
				<TooltipProvider delayDuration={150}>
					{isMobile ? (
						<MobileShell
							user={shellUser}
							inProject={inProject}
							onNewProject={() => setCreateOpen(true)}
							onEditProfile={() => setProfileOpen(true)}
							onOpenProjects={() => setMobileProjectsOpen(true)}
							onOpenHistory={() => setMobileHistoryOpen(true)}
						/>
					) : (
						<DesktopShell
							user={shellUser}
							inProject={inProject}
							pinnedChat={pinnedChat}
							setPinnedSlot={setPinnedSlot}
							onNewProject={() => setCreateOpen(true)}
							onEditProfile={() => setProfileOpen(true)}
						/>
					)}
					{/* Hidden fallback host keeps ChatPanel mounted even when the chat is
				    "closed" — toggling pin / sheet / closed doesn't unmount the chat,
				    so the conversation survives every mode flip. Also keeps state
				    across desktop ↔ mobile viewport flips. */}
					<div ref={setFallbackSlot} aria-hidden className="hidden" />
					{/* Sheet stays mounted; we just control its `open` from the dock state.
				    The slot div is the portal target when mode === "sheet". */}
					<Sheet
						open={dockMode === "sheet"}
						onOpenChange={(open) => {
							if (open) chatDock.openSheet();
							else if (dockMode === "sheet") chatDock.close();
						}}
					>
						<SheetContent
							side="right"
							className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
						>
							<SheetHeader className="sr-only">
								<SheetTitle>Project chat</SheetTitle>
								<SheetDescription>
									Conversation with the AI planning assistant.
								</SheetDescription>
							</SheetHeader>
							<div
								ref={setSheetSlot}
								className="flex min-h-0 flex-1 flex-col"
							/>
						</SheetContent>
					</Sheet>
					<ChatHost target={chatTarget} />
					{/* Mobile-only chrome — projects sidebar replacement and history
				    drawer. Kept here so the state lives alongside the other dialogs;
				    rendering is gated by `isMobile` to avoid them ever opening on
				    desktop. */}
					{isMobile && (
						<>
							<MobileProjectsSheet
								open={mobileProjectsOpen}
								onOpenChange={setMobileProjectsOpen}
								onNewProject={() => setCreateOpen(true)}
							/>
							<MobileHistorySheet
								open={mobileHistoryOpen && inProject}
								onOpenChange={setMobileHistoryOpen}
							/>
						</>
					)}
					<CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
					<ProfileDialog
						open={profileOpen}
						onOpenChange={setProfileOpen}
						user={session.user}
						required={!sessionName}
					/>
					<Toaster />
				</TooltipProvider>
			</RepoProvider>
		</ViewModeProvider>
	);
}

// Renders nothing — just keeps the offline-create reconcile loop running for
// the lifetime of the authed shell (and inside RepoProvider for the sync nudge).
function ReconcilerMount() {
	useReconciler();
	return null;
}

function DesktopShell({
	user,
	inProject,
	pinnedChat,
	setPinnedSlot,
	onNewProject,
	onEditProfile,
}: {
	user: {
		name?: string | null;
		email: string;
		image?: string | null;
		isAdmin: boolean;
	};
	inProject: boolean;
	pinnedChat: boolean;
	setPinnedSlot: (el: HTMLDivElement | null) => void;
	onNewProject: () => void;
	onEditProfile: () => void;
}) {
	// Refs into the collapsible panels so the divider toggles can drive them
	// imperatively (react-resizable-panels handles the size animation + min
	// clamping). Mirror collapse state into React so the button icons can flip.
	const leftRef = useRef<PanelImperativeHandle>(null);
	const bottomRef = useRef<PanelImperativeHandle>(null);
	const chatRef = useRef<PanelImperativeHandle>(null);
	const [leftCollapsed, setLeftCollapsed] = useState(false);
	const [bottomCollapsed, setBottomCollapsed] = useState(false);
	// Collapsing the pinned chat rail keeps it *pinned* (its panel stays
	// mounted at size 0) — distinct from closing it, which drops the dock back
	// to sheet mode. So the conversation and the pinned arrangement both survive.
	const [chatCollapsed, setChatCollapsed] = useState(false);

	const toggleLeft = useCallback(() => {
		const p = leftRef.current;
		if (!p) return;
		p.isCollapsed() ? p.expand() : p.collapse();
	}, []);
	const toggleBottom = useCallback(() => {
		const p = bottomRef.current;
		if (!p) return;
		p.isCollapsed() ? p.expand() : p.collapse();
	}, []);
	const toggleChat = useCallback(() => {
		const p = chatRef.current;
		if (!p) return;
		p.isCollapsed() ? p.expand() : p.collapse();
	}, []);

	return (
		<div className="flex h-svh w-svw flex-col bg-background">
			<TopBar
				user={user}
				onNewProject={onNewProject}
				onEditProfile={onEditProfile}
				// Still passed so the topbar can hide the workspace switcher when
				// the sidebar is collapsed — the collapse *control* itself now
				// lives on the sidebar divider (see the ResizableHandle below).
				leftCollapsed={leftCollapsed}
				// The chat trigger is gated on the active project: chat is bound
				// to a project.
				showChatTrigger={inProject}
			/>
			<div className="min-h-0 flex-1">
				<ResizablePanelGroup
					// Remount when the pin state flips so the new column count picks
					// up sensible defaults instead of inheriting the previous layout.
					key={pinnedChat ? "shell-pinned" : "shell-sheet"}
					orientation="horizontal"
					className="h-full w-full"
				>
					<ResizablePanel
						panelRef={leftRef}
						defaultSize={pinnedChat ? "14%" : "18%"}
						minSize="10%"
						maxSize="32%"
						collapsible
						collapsedSize={0}
						onResize={(size) => setLeftCollapsed(size.asPercentage === 0)}
						className="bg-sidebar"
					>
						<LeftNav onNewProject={onNewProject} />
					</ResizablePanel>

					<ResizableHandle
						withHandle
						toggle={{
							collapsed: leftCollapsed,
							onToggle: toggleLeft,
							label: leftCollapsed ? "Show sidebar" : "Hide sidebar",
							testId: "panel-toggle-left",
							side: "left",
							collapseIcon: <ChevronLeftIcon />,
							expandIcon: <ChevronRightIcon />,
						}}
					/>

					<ResizablePanel
						// Remount when the bottom panel toggles in/out so the new
						// inner layout (vertical split vs single pane) doesn't fight
						// react-resizable-panels' size accounting.
						key={inProject ? "main-with-bottom" : "main-only"}
						defaultSize={pinnedChat ? "54%" : "82%"}
						minSize="30%"
					>
						{inProject ? (
							<ResizablePanelGroup
								orientation="vertical"
								className="h-full w-full"
							>
								<ResizablePanel defaultSize="62%" minSize="30%">
									<main className="h-full overflow-hidden">
										<Outlet />
									</main>
								</ResizablePanel>
								<ResizableHandle
									withHandle
									toggle={{
										collapsed: bottomCollapsed,
										onToggle: toggleBottom,
										label: bottomCollapsed
											? "Show details panel"
											: "Hide details panel",
										testId: "panel-toggle-bottom",
										side: "bottom",
										collapseIcon: <ChevronDownIcon />,
										expandIcon: <ChevronUpIcon />,
									}}
								/>
								<ResizablePanel
									panelRef={bottomRef}
									defaultSize="38%"
									minSize="14%"
									collapsible
									collapsedSize={0}
									onResize={(size) =>
										setBottomCollapsed(size.asPercentage === 0)
									}
									className="bg-card"
								>
									<RightTabs />
								</ResizablePanel>
							</ResizablePanelGroup>
						) : (
							<main className="h-full overflow-hidden">
								<Outlet />
							</main>
						)}
					</ResizablePanel>

					{pinnedChat && (
						<>
							<ResizableHandle
								withHandle
								toggle={{
									collapsed: chatCollapsed,
									onToggle: toggleChat,
									label: chatCollapsed ? "Show chat" : "Hide chat",
									testId: "panel-toggle-chat",
									side: "right",
									collapseIcon: <ChevronRightIcon />,
									expandIcon: <ChevronLeftIcon />,
								}}
							/>
							<ResizablePanel
								panelRef={chatRef}
								defaultSize="32%"
								minSize="20%"
								maxSize="50%"
								collapsible
								collapsedSize={0}
								onResize={(size) => setChatCollapsed(size.asPercentage === 0)}
								// Clip the portaled chat so a zero-width (collapsed) rail
								// doesn't let the chat's min-width content spill off-screen
								// — the sidebar/bottom panels clip via their own inner
								// scroll/overflow, but this slot has none of its own.
								className="overflow-hidden bg-card"
							>
								<div ref={setPinnedSlot} className="h-full" />
							</ResizablePanel>
						</>
					)}
				</ResizablePanelGroup>
			</div>
		</div>
	);
}

function MobileShell({
	user,
	inProject,
	onNewProject,
	onEditProfile,
	onOpenProjects,
	onOpenHistory,
}: {
	user: {
		name?: string | null;
		email: string;
		image?: string | null;
		isAdmin: boolean;
	};
	inProject: boolean;
	onNewProject: () => void;
	onEditProfile: () => void;
	onOpenProjects: () => void;
	onOpenHistory: () => void;
}) {
	// `onNewProject` is exposed here for symmetry with the desktop shell —
	// the mobile "+ project" affordance lives inside MobileProjectsSheet
	// rather than the top bar, so we pass it through to that sheet from the
	// outer AppShell, not from here. Reference the prop so TS strict's
	// noUnusedParameters doesn't complain.
	void onNewProject;
	return (
		<div className="flex h-svh w-svw flex-col bg-background">
			<MobileTopBar
				user={user}
				onOpenProjects={onOpenProjects}
				onOpenHistory={onOpenHistory}
				onEditProfile={onEditProfile}
			/>
			<main className="min-h-0 flex-1 overflow-hidden">
				<Outlet />
			</main>
			{inProject && <MobileBottomNav />}
		</div>
	);
}

function MobileHistorySheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="left" className="flex w-80 flex-col gap-0 p-0">
				<SheetHeader className="shrink-0 border-b p-3 text-left">
					<SheetTitle className="text-base">History</SheetTitle>
					<SheetDescription className="sr-only">
						Recent edits to this project.
					</SheetDescription>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-hidden">
					<HistoryDrawer />
				</div>
			</SheetContent>
		</Sheet>
	);
}

function TopBar({
	user,
	onNewProject,
	onEditProfile,
	leftCollapsed,
	showChatTrigger,
}: {
	user: {
		name?: string | null;
		email: string;
		image?: string | null;
		isAdmin: boolean;
	};
	onNewProject: () => void;
	onEditProfile: () => void;
	leftCollapsed: boolean;
	showChatTrigger: boolean;
}) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
			<Link to="/" className="flex items-center gap-2">
				<div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
					<LayersIcon className="size-4" />
				</div>
				<span className="font-semibold tracking-tight">pert.li</span>
			</Link>
			{/* The workspace selector lives with the sidebar conceptually — hide
			    it whenever the sidebar is collapsed so the user gets a clean,
			    chrome-light top bar when they're focused on the canvas. */}
			{!leftCollapsed && (
				<>
					<Separator orientation="vertical" className="h-5" />
					<WorkspaceSwitcher />
				</>
			)}
			<div className="flex-1" />
			<Button
				size="sm"
				variant="default"
				className="gap-1.5"
				onClick={onNewProject}
			>
				<PlusIcon className="size-4" />
				New project
			</Button>
			<SyncStatus />
			{showChatTrigger && <ChatTrigger />}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						variant="ghost"
						className="gap-2 px-2"
						aria-label="Account menu"
					>
						<UserAvatar
							name={user.name}
							email={user.email}
							image={user.image}
							size={28}
						/>
						<span className="hidden text-sm md:inline">
							{user.name ?? user.email}
						</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-56">
					<DropdownMenuLabel className="font-normal">
						<div className="text-sm font-medium">{user.name ?? user.email}</div>
						<div className="text-xs text-muted-foreground">{user.email}</div>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={onEditProfile}>
						<UserCogIcon className="size-4" />
						Edit profile
					</DropdownMenuItem>
					{user.isAdmin && (
						<DropdownMenuItem asChild>
							<Link to="/admin" data-testid="topbar-nav-admin">
								<ShieldIcon className="size-4" />
								Admin
							</Link>
						</DropdownMenuItem>
					)}
					<SyncNowItem />
					<ThemeMenu />
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => void signOutEverywhere()}>
						<LogOutIcon className="size-4" />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</header>
	);
}

const THEME_OPTIONS: Array<{
	value: ThemeMode;
	label: string;
	Icon: typeof SunIcon;
}> = [
	{ value: "light", label: "Light", Icon: SunIcon },
	{ value: "dark", label: "Dark", Icon: MoonIcon },
	{ value: "system", label: "System", Icon: LaptopIcon },
];

function ThemeMenu() {
	const mode = useThemeMode();
	const current =
		THEME_OPTIONS.find((opt) => opt.value === mode) ?? THEME_OPTIONS[2];
	const CurrentIcon = current.Icon;
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<CurrentIcon className="size-4" />
				Theme
				<span className="ml-auto text-xs text-muted-foreground">
					{current.label}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				{THEME_OPTIONS.map(({ value, label, Icon }) => (
					<DropdownMenuItem
						key={value}
						onClick={() => setThemeMode(value)}
						data-testid={`theme-${value}`}
					>
						<Icon className="size-4" />
						{label}
						{mode === value && <CheckIcon className="ml-auto size-3.5" />}
					</DropdownMenuItem>
				))}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function ChatTrigger() {
	const mode = useChatDockMode();
	return (
		<Button
			size="sm"
			variant={mode === "pinned" ? "secondary" : "ghost"}
			className="gap-1.5"
			aria-label="Open chat"
			aria-pressed={mode !== "closed"}
			data-testid="topbar-chat-trigger"
			onClick={() => {
				if (mode === "closed") chatDock.openSheet();
				else chatDock.close();
			}}
		>
			<BotIcon className="size-4" />
			Chat
		</Button>
	);
}

// Singleton ChatPanel host. ChatPanel mounts here once and its DOM is
// teleported via createPortal to whichever slot the dock points at — Sheet
// body, pinned column, or a hidden fallback. The React instance never
// remounts on a mode flip, so useChat's in-memory message log persists.
// Tutorial CTAs go through the dock store's pendingPrompt; ChatPanel
// consumes them internally and appends to the transcript.
function ChatHost({ target }: { target: HTMLDivElement | null }) {
	if (!target) return null;
	return createPortal(<ChatPanel showDockControls />, target);
}

function LeftNav({ onNewProject }: { onNewProject: () => void }) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const projectsQuery = useQuery({
		queryKey: ["projects", activeWorkspaceId],
		queryFn: () =>
			listProjects({
				data: activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {},
			}),
	});
	// `useParams` with `strict: false` returns the active leaf's params if it
	// matches; otherwise `{}`. Used to highlight the active project.
	const params = useParams({ strict: false }) as { projectId?: string };
	// Union the server list with offline-created projects so they appear here
	// even before they register (or while the workspace is offline), scoped to
	// the active workspace.
	const projects = useMergedProjects(
		projectsQuery.data ?? [],
		activeWorkspaceId,
	);

	return (
		<div className="flex h-full flex-col">
			<nav className="flex flex-col gap-1 p-2 text-sm">
				<Link
					to="/"
					className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
					activeOptions={{ exact: true }}
				>
					<FolderTreeIcon className="size-4" />
					Workspace
				</Link>
			</nav>
			<Separator />
			<div className="flex items-center justify-between gap-1 px-3 py-2">
				<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					Projects
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					aria-label="New project"
					onClick={onNewProject}
				>
					<PlusIcon className="size-3.5" />
				</Button>
			</div>
			<ScrollArea className="flex-1">
				{projectsQuery.isPending && projects.length === 0 ? (
					<div className="px-3 py-2 text-xs text-muted-foreground">
						Loading…
					</div>
				) : projectsQuery.isError && projects.length === 0 ? (
					<div className="px-3 py-2 text-xs text-destructive">
						Couldn't load projects
					</div>
				) : (
					<ProjectList
						projects={projects}
						activeProjectId={params.projectId}
						empty="No projects yet."
					/>
				)}
			</ScrollArea>
		</div>
	);
}

// Right-rail panel: four sibling tabs across the inspector + history. The
// inspector's old "All details / Edit · Calc · Progress" split lives here as
// three top-level tabs: Details (read-only summary), Plan (create + estimate),
// Track (mark started/finished). Defaults to Plan so opening a project lands
// on the most-edited surface.
function RightTabs() {
	return (
		<Tabs
			defaultValue="plan"
			className="flex h-full min-h-0 flex-col gap-0"
			data-testid="right-tabs"
		>
			<div className="shrink-0 border-b bg-card/40 px-2 py-1.5">
				<TabsList variant="line" className="w-full">
					<TabsTrigger
						value="details"
						className="gap-1.5 text-xs"
						data-testid="right-tab-details"
					>
						<EyeIcon className="size-3.5" />
						Details
					</TabsTrigger>
					<TabsTrigger
						value="plan"
						className="gap-1.5 text-xs"
						data-testid="right-tab-plan"
					>
						<PencilIcon className="size-3.5" />
						Plan
					</TabsTrigger>
					<TabsTrigger
						value="track"
						className="gap-1.5 text-xs"
						data-testid="right-tab-track"
					>
						<CircleDotIcon className="size-3.5" />
						Track
					</TabsTrigger>
					<TabsTrigger
						value="history"
						className="gap-1.5 text-xs"
						data-testid="right-tab-history"
					>
						<HistoryIcon className="size-3.5" />
						History
					</TabsTrigger>
				</TabsList>
			</div>
			<TabsContent
				value="details"
				// `mt-0` because the default Tabs layout adds a gap-2 the right rail
				// doesn't want — the tab strip already has its own bottom border.
				className="mt-0 min-h-0 flex-1 overflow-hidden"
			>
				<TaskInspector pane="details" />
			</TabsContent>
			<TabsContent value="plan" className="mt-0 min-h-0 flex-1 overflow-hidden">
				<TaskInspector pane="plan" />
			</TabsContent>
			<TabsContent
				value="track"
				className="mt-0 min-h-0 flex-1 overflow-hidden"
			>
				<TaskInspector pane="track" />
			</TabsContent>
			<TabsContent
				value="history"
				className="mt-0 min-h-0 flex-1 overflow-hidden"
			>
				<HistoryDrawer />
			</TabsContent>
		</Tabs>
	);
}

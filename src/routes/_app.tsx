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
	ChevronsUpDownIcon,
	FolderTreeIcon,
	LaptopIcon,
	LayersIcon,
	LogOutIcon,
	MoonIcon,
	PlusIcon,
	SunIcon,
	UserIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ChatPanel } from "#/components/ai/chat-panel";
import { HistoryDrawer } from "#/components/pert/history/history-drawer";
import { TaskInspector } from "#/components/pert/inspector/task-inspector";
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
	SheetTrigger,
} from "#/components/ui/sheet";
import { TooltipProvider } from "#/components/ui/tooltip";
import { CreateProjectDialog } from "#/components/workspace/create-project-dialog";
import { ProjectList } from "#/components/workspace/project-list";
import { authClient } from "#/lib/auth-client";
import { setThemeMode, type ThemeMode, useThemeMode } from "#/lib/theme";
import { listProjects } from "#/server/workspace.ts";

export const Route = createFileRoute("/_app")({
	component: AppShell,
});

function AppShell() {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();
	const [createOpen, setCreateOpen] = useState(false);

	useEffect(() => {
		if (!isPending && !session) {
			navigate({ to: "/signin" });
		}
	}, [isPending, session, navigate]);

	if (isPending || !session) {
		return (
			<div className="grid min-h-svh place-items-center text-sm text-muted-foreground">
				Loading…
			</div>
		);
	}

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex h-svh w-svw flex-col bg-background">
				<TopBar user={session.user} onNewProject={() => setCreateOpen(true)} />
				<div className="min-h-0 flex-1">
					<ResizablePanelGroup
						orientation="horizontal"
						className="h-full w-full"
					>
						<ResizablePanel
							defaultSize="18%"
							minSize="12%"
							maxSize="32%"
							className="bg-sidebar"
						>
							<LeftNav onNewProject={() => setCreateOpen(true)} />
						</ResizablePanel>

						<ResizableHandle withHandle />

						<ResizablePanel defaultSize="56%" minSize="30%">
							<ResizablePanelGroup
								orientation="vertical"
								className="h-full w-full"
							>
								<ResizablePanel defaultSize="70%" minSize="30%">
									<main className="h-full overflow-hidden">
										<Outlet />
									</main>
								</ResizablePanel>
								<ResizableHandle withHandle />
								<ResizablePanel
									defaultSize="30%"
									minSize="10%"
									collapsible
									className="bg-muted/30"
								>
									<BottomDrawer />
								</ResizablePanel>
							</ResizablePanelGroup>
						</ResizablePanel>

						<ResizableHandle withHandle />

						<ResizablePanel
							defaultSize="26%"
							minSize="18%"
							maxSize="42%"
							collapsible
							className="bg-card"
						>
							<RightInspector />
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			</div>
			<CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
		</TooltipProvider>
	);
}

function TopBar({
	user,
	onNewProject,
}: {
	user: { name?: string | null; email: string };
	onNewProject: () => void;
}) {
	const initials = (user.name ?? user.email)
		.split(/\s+/)
		.map((s) => s[0]?.toUpperCase())
		.filter(Boolean)
		.slice(0, 2)
		.join("");

	return (
		<header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-3">
			<Link to="/" className="flex items-center gap-2">
				<div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
					<LayersIcon className="size-4" />
				</div>
				<span className="font-semibold tracking-tight">pert.li</span>
			</Link>
			<Separator orientation="vertical" className="h-5" />
			<WorkspaceSwitcher />
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
			<ChatTrigger />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						variant="ghost"
						className="gap-2 px-2"
						aria-label="Account menu"
					>
						<span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium">
							{initials || <UserIcon className="size-4" />}
						</span>
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
					<ThemeMenu />
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => void authClient.signOut()}>
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
	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button
					size="sm"
					variant="ghost"
					className="gap-1.5"
					aria-label="Open chat"
					data-testid="topbar-chat-trigger"
				>
					<BotIcon className="size-4" />
					Chat
				</Button>
			</SheetTrigger>
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
				<ChatPanel />
			</SheetContent>
		</Sheet>
	);
}

function WorkspaceSwitcher() {
	return (
		<Button variant="ghost" size="sm" className="gap-2 text-sm font-medium">
			<FolderTreeIcon className="size-4 text-muted-foreground" />
			Personal workspace
			<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
		</Button>
	);
}

function LeftNav({ onNewProject }: { onNewProject: () => void }) {
	const projectsQuery = useQuery({
		queryKey: ["projects"],
		queryFn: () => listProjects(),
	});
	// `useParams` with `strict: false` returns the active leaf's params if it
	// matches; otherwise `{}`. Used to highlight the active project.
	const params = useParams({ strict: false }) as { projectId?: string };

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
				{projectsQuery.isPending ? (
					<div className="px-3 py-2 text-xs text-muted-foreground">
						Loading…
					</div>
				) : projectsQuery.isError ? (
					<div className="px-3 py-2 text-xs text-destructive">
						Couldn't load projects
					</div>
				) : (
					<ProjectList
						projects={projectsQuery.data ?? []}
						activeProjectId={params.projectId}
						empty="No projects yet."
					/>
				)}
			</ScrollArea>
		</div>
	);
}

function RightInspector() {
	return (
		<div className="flex h-full flex-col">
			<TaskInspector />
		</div>
	);
}

function BottomDrawer() {
	return <HistoryDrawer />;
}

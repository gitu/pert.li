import type { AnyDocumentId, DocHandle } from "@automerge/automerge-repo";
import {
	useDocHandle,
	useDocument,
} from "@automerge/automerge-repo-react-hooks";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
	GridIcon,
	ListIcon,
	MaximizeIcon,
	MinimizeIcon,
	NetworkIcon,
	TimerIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { CanvasLoading } from "#/components/canvas/canvas-loading";
import { PertCanvas } from "#/components/pert/canvas/canvas";
import { FullscreenInspectorPopup } from "#/components/pert/inspector/fullscreen-inspector-popup";
import { TaskListView } from "#/components/pert/list/task-list-view";
import { MatrixView } from "#/components/pert/matrix/matrix-view";
import { TimelineView } from "#/components/pert/timeline/timeline-view";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { useOptionalRepo } from "#/lib/automerge/provider";
import { usePresenceSelection } from "#/lib/automerge/use-presence-selection";
import {
	type PertProjectDoc,
	useProjectDoc,
} from "#/lib/automerge/use-project-doc";
import {
	clearActiveProjectDoc,
	selectionStore,
	selectTask,
	setActiveProjectDoc,
} from "#/lib/pert/store";
import { useFullscreen } from "#/lib/use-fullscreen";
import { cn } from "#/lib/utils";

export type ProjectView = "network" | "timeline" | "table" | "matrix";

type ProjectSearch = { view?: ProjectView };

// Plain validator (no Zod) so any unexpected query strings degrade to the
// default Network view instead of throwing a router notFound. Returns only
// the keys we care about; TanStack Router treats the result as canonical.
//
// Accepts the legacy `list` alias for backwards compatibility with any
// shared links from Phase 5 — it maps to the new `table` view.
function validateProjectSearch(raw: Record<string, unknown>): ProjectSearch {
	const v = raw?.view;
	if (v === "timeline") return { view: "timeline" };
	if (v === "table" || v === "list") return { view: "table" };
	if (v === "matrix") return { view: "matrix" };
	if (v === "network") return { view: "network" };
	return {};
}

export const Route = createFileRoute("/_app/p/$projectId")({
	component: ProjectCanvas,
	validateSearch: validateProjectSearch,
});

function ProjectCanvas() {
	const { projectId } = Route.useParams();
	const search = useSearch({ from: "/_app/p/$projectId" });
	const view: ProjectView = search.view ?? "network";
	const repo = useOptionalRepo();

	// Fullscreen at project level — wraps header tabs + active view + the
	// floating inspector popup. The user can switch between Network /
	// Timeline / Table / Matrix while staying in fullscreen.
	const fullscreenRef = useRef<HTMLDivElement>(null);
	const { active: fullscreenActive, toggle: toggleFullscreen } =
		useFullscreen(fullscreenRef);
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	return (
		<div
			ref={fullscreenRef}
			data-fullscreen={fullscreenActive || undefined}
			className="relative flex h-full flex-col overflow-hidden bg-background"
		>
			<ProjectViewHeader
				projectId={projectId}
				view={view}
				fullscreen={fullscreenActive}
				onToggleFullscreen={toggleFullscreen}
			/>
			<div className="relative flex-1 overflow-hidden">
				{repo ? (
					<RepoReadyCanvas projectId={projectId} view={view} />
				) : (
					<CanvasLoading message="Initializing local sync repo…" />
				)}
			</div>
			{fullscreenActive && selectedTaskId && (
				<FullscreenInspectorPopup onClose={() => selectTask(projectId, null)} />
			)}
		</div>
	);
}

const VIEW_TABS: Array<{
	id: ProjectView;
	label: string;
	Icon: typeof NetworkIcon;
}> = [
	{ id: "network", label: "Network", Icon: NetworkIcon },
	{ id: "timeline", label: "Timeline", Icon: TimerIcon },
	{ id: "table", label: "Table", Icon: ListIcon },
	{ id: "matrix", label: "Matrix", Icon: GridIcon },
];

function ProjectViewHeader({
	projectId,
	view,
	fullscreen,
	onToggleFullscreen,
}: {
	projectId: string;
	view: ProjectView;
	fullscreen: boolean;
	onToggleFullscreen: () => void;
}) {
	const navigate = useNavigate();
	const setView = (next: ProjectView) =>
		navigate({
			to: "/p/$projectId",
			params: { projectId },
			search: { view: next === "network" ? undefined : next },
			replace: true,
		});
	return (
		<header className="flex h-10 shrink-0 items-center gap-2 border-b bg-card/40 px-3">
			<div className="flex items-center gap-1.5 text-xs">
				<NetworkIcon className="size-3.5" />
				<span className="font-medium">project</span>
				<span className="text-muted-foreground">{shortId(projectId)}</span>
			</div>
			<div className="flex-1" />
			<div
				role="tablist"
				aria-label="Project view"
				className="flex items-center gap-0.5 rounded-md border bg-background p-0.5"
			>
				{VIEW_TABS.map((tab) => (
					<ViewTab
						key={tab.id}
						label={tab.label}
						Icon={tab.Icon}
						active={view === tab.id}
						testId={`view-tab-${tab.id}`}
						onSelect={() => setView(tab.id)}
					/>
				))}
			</div>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-8 gap-1.5 text-xs"
				onClick={onToggleFullscreen}
				aria-pressed={fullscreen}
				data-testid="project-fullscreen"
				title={fullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
			>
				{fullscreen ? (
					<MinimizeIcon className="size-3.5" />
				) : (
					<MaximizeIcon className="size-3.5" />
				)}
				{fullscreen ? "Exit" : "Fullscreen"}
			</Button>
		</header>
	);
}

function ViewTab({
	label,
	Icon,
	active,
	onSelect,
	testId,
}: {
	label: string;
	Icon: typeof NetworkIcon;
	active: boolean;
	onSelect: () => void;
	testId: string;
}) {
	return (
		<button
			type="button"
			role="tab"
			data-testid={testId}
			aria-selected={active}
			onClick={onSelect}
			className={cn(
				"inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs",
				active
					? "bg-accent text-accent-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			<Icon className="size-3.5" />
			{label}
		</button>
	);
}

function RepoReadyCanvas({
	projectId,
	view,
}: {
	projectId: string;
	view: ProjectView;
}) {
	const resolution = useProjectDoc(projectId);

	if (resolution.status === "loading") {
		return <CanvasLoading message="Resolving project…" />;
	}
	if (resolution.status === "not-found") {
		return <ProjectNotFound />;
	}
	return (
		<PertProjectPanel
			projectId={projectId}
			documentId={resolution.documentId}
			view={view}
		/>
	);
}

function PertProjectPanel({
	projectId,
	documentId,
	view,
}: {
	projectId: string;
	documentId: AnyDocumentId;
	view: ProjectView;
}) {
	const [doc, changeDoc] = useDocument<PertProjectDoc>(documentId, {
		suspense: false,
	});
	const handle = useDocHandle<PertProjectDoc>(documentId, { suspense: false });

	// Phase 1/2 docs were minted with `{ title, count }` only; back-fill the
	// Phase 3 maps on first load so the CPM engine sees a well-typed PertDoc.
	const needsMigration =
		doc !== undefined &&
		(!doc.tasksById ||
			!doc.dependenciesById ||
			!doc.interfacesByContainerId ||
			!doc.viewsById);
	useEffect(() => {
		if (!needsMigration) return;
		changeDoc((d) => {
			const legacy = d as unknown as Record<string, unknown>;
			legacy.tasksById ??= {};
			legacy.dependenciesById ??= {};
			legacy.interfacesByContainerId ??= {};
			legacy.viewsById ??= {};
			if ("count" in legacy) delete legacy.count;
		});
	}, [needsMigration, changeDoc]);

	// Lift the active doc + handle into the cross-pane store so the right
	// inspector, history drawer, and presence overlays (which live in the
	// parent shell) can read and edit without a context provider snake.
	useEffect(() => {
		if (!doc || needsMigration) return;
		setActiveProjectDoc(projectId, doc, changeDoc, handle ?? null);
	}, [doc, changeDoc, handle, projectId, needsMigration]);
	useEffect(() => () => clearActiveProjectDoc(projectId), [projectId]);

	if (!doc || needsMigration) {
		return <CanvasLoading message="Loading document…" />;
	}

	return (
		<div className="h-full">
			{handle && <PresenceBroadcaster projectId={projectId} handle={handle} />}
			{view === "table" ? (
				<TaskListView projectId={projectId} doc={doc} />
			) : view === "timeline" ? (
				<TimelineView projectId={projectId} doc={doc} />
			) : view === "matrix" ? (
				<MatrixView projectId={projectId} doc={doc} />
			) : (
				<PertCanvas projectId={projectId} doc={doc} changeDoc={changeDoc} />
			)}
		</div>
	);
}

function PresenceBroadcaster({
	projectId,
	handle,
}: {
	projectId: string;
	handle: DocHandle<PertProjectDoc>;
}) {
	const { data: session } = authClient.useSession();
	const userId = session?.user?.id ?? "anonymous";
	const displayName = session?.user?.name ?? session?.user?.email ?? null;
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);
	usePresenceSelection({
		projectId,
		userId,
		displayName,
		selectedTaskId,
		handle,
	});
	return null;
}

function ProjectNotFound() {
	return (
		<div className="grid h-full place-items-center p-6 text-center">
			<div className="max-w-sm space-y-3">
				<h2 className="text-lg font-semibold">Project not found</h2>
				<p className="text-sm text-muted-foreground">
					The project either doesn't exist or your account doesn't have access
					to it.
				</p>
				<Button asChild variant="secondary" size="sm">
					<Link to="/">Back to workspace</Link>
				</Button>
			</div>
		</div>
	);
}

function shortId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

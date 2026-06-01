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
	Share2Icon,
	TimerIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CanvasLoading } from "#/components/canvas/canvas-loading";
import { PertCanvas } from "#/components/pert/canvas/canvas";
import { ExportProjectButton } from "#/components/pert/exchange/export-button";
import { FullscreenInspectorPopup } from "#/components/pert/inspector/fullscreen-inspector-popup";
import { MobileInspectorSheet } from "#/components/pert/inspector/mobile-inspector-sheet";
import { TaskCardList } from "#/components/pert/list/task-card-list";
import { TaskListView } from "#/components/pert/list/task-list-view";
import { MatrixMobile } from "#/components/pert/matrix/matrix-mobile";
import { MatrixView } from "#/components/pert/matrix/matrix-view";
import { ProjectCalendarSheet } from "#/components/pert/project-calendar-sheet";
import { TimelineMobile } from "#/components/pert/timeline/timeline-mobile";
import { TimelineView } from "#/components/pert/timeline/timeline-view";
import { Button } from "#/components/ui/button";
import { ShareProjectDialog } from "#/components/workspace/share-project-dialog";
import { authClient } from "#/lib/auth-client";
import { useOptionalRepo } from "#/lib/automerge/provider";
import { usePresenceSelection } from "#/lib/automerge/use-presence-selection";
import {
	type PertProjectDoc,
	useProjectDoc,
} from "#/lib/automerge/use-project-doc";
import { ensureContainerInterfaces } from "#/lib/pert/interfaces";
import {
	clearActiveProjectDoc,
	projectDocStore,
	selectionStore,
	selectTask,
	setActiveProjectDoc,
} from "#/lib/pert/store";
import { shareIdentityStore } from "#/lib/share-identity";
import { useFullscreen } from "#/lib/use-fullscreen";
import { useIsMobile } from "#/lib/use-media-query";
import { cn } from "#/lib/utils";
import { useViewMode } from "#/lib/view-mode";

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
	const isMobile = useIsMobile();

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
			{!isMobile && (
				<ProjectViewHeader
					projectId={projectId}
					view={view}
					fullscreen={fullscreenActive}
					onToggleFullscreen={toggleFullscreen}
				/>
			)}
			<div className="relative flex-1 overflow-hidden">
				{repo ? (
					<RepoReadyCanvas projectId={projectId} view={view} />
				) : (
					<CanvasLoading message="Initializing local sync repo…" />
				)}
			</div>
			{isMobile ? (
				<MobileInspectorSheet projectId={projectId} />
			) : (
				fullscreenActive &&
				selectedTaskId && (
					<FullscreenInspectorPopup
						onClose={() => selectTask(projectId, null)}
					/>
				)
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
		<header
			// `min-h-10` instead of `h-10` so the row can grow taller when the
			// view tabs + project chrome don't fit on a single line on narrow
			// mobile viewports. `flex-wrap` lets them spill onto a second row.
			className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b bg-card/40 px-3 py-1"
		>
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
			<HeaderCalendarSheet projectId={projectId} />
			<HeaderExportButton projectId={projectId} />
			<HeaderShareButton projectId={projectId} />
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

function HeaderCalendarSheet({ projectId }: { projectId: string }) {
	const { doc, changeDoc, projectId: activeId } = useStore(projectDocStore);
	if (!doc || !changeDoc || activeId !== projectId) return null;
	return <ProjectCalendarSheet doc={doc} changeDoc={changeDoc} />;
}

function HeaderExportButton({ projectId }: { projectId: string }) {
	const { doc, projectId: activeId } = useStore(projectDocStore);
	if (!doc || activeId !== projectId) return null;
	return <ExportProjectButton doc={doc} />;
}

function HeaderShareButton({ projectId }: { projectId: string }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-8 gap-1.5 text-xs"
				onClick={() => setOpen(true)}
				data-testid="project-share"
				title="Share this project"
			>
				<Share2Icon className="size-3.5" />
				Share
			</Button>
			<ShareProjectDialog
				projectId={projectId}
				open={open}
				onOpenChange={setOpen}
			/>
		</>
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

// Exported so the public /share/$token route can drive the canvas tree
// with the share-resolved `documentId` directly, skipping the auth-gated
// `useProjectDoc` resolution that the in-app route uses.
export function PertProjectPanel({
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
	const { mode } = useViewMode();
	// Mobile-readonly suppresses every inline edit affordance by withholding
	// `changeDoc` from the shared store. Existing consumers (TaskInspector,
	// TaskListView, MatrixView, CalendarSheet, …) already gate on
	// `!changeDoc`, so this single null gate flips the entire surface.
	const effectiveChangeDoc = mode === "mobile-readonly" ? null : changeDoc;

	// Phase 1/2 docs were minted with `{ title, count }` only; back-fill the
	// Phase 3 maps on first load so the CPM engine sees a well-typed PertDoc.
	const needsMigration =
		doc !== undefined &&
		(!doc.tasksById ||
			!doc.dependenciesById ||
			!doc.interfacesByContainerId ||
			!doc.viewsById);
	useEffect(() => {
		// Skip in read-only modes (mobile-readonly, view-mode share). The
		// next authenticated editor to open the doc runs the migration; a
		// public viewer must not write to the project they're only viewing.
		if (!needsMigration || !effectiveChangeDoc) return;
		effectiveChangeDoc((d) => {
			const legacy = d as unknown as Record<string, unknown>;
			legacy.tasksById ??= {};
			legacy.dependenciesById ??= {};
			legacy.interfacesByContainerId ??= {};
			legacy.viewsById ??= {};
			if ("count" in legacy) delete legacy.count;
		});
	}, [needsMigration, effectiveChangeDoc]);

	// Pre-rework containers were created without default Entry/Exit interfaces.
	// Backfill them once on first load so cross-boundary edges have a port to
	// route through when the container collapses. Idempotent — re-runs only
	// touch containers that are still missing a default.
	const containersMissingInterfaces =
		doc?.tasksById && doc.interfacesByContainerId
			? Object.values(doc.tasksById).filter((t) => {
					if (t.kind !== "container") return false;
					const bucket = doc.interfacesByContainerId[t.id];
					if (!bucket) return true;
					const kinds = new Set<string>();
					for (const i of Object.values(bucket)) kinds.add(i.kind);
					return !kinds.has("entry") || !kinds.has("exit");
				})
			: [];
	const containerBackfillKey = containersMissingInterfaces
		.map((t) => t.id)
		.join(",");
	useEffect(() => {
		// Same read-only guard as the schema migration above — a view-only
		// recipient must not write container backfills to the project.
		if (needsMigration || containerBackfillKey === "" || !effectiveChangeDoc)
			return;
		effectiveChangeDoc((d) => {
			for (const id of containerBackfillKey.split(",")) {
				if (d.tasksById[id]?.kind === "container") {
					ensureContainerInterfaces(d, id);
				}
			}
		});
	}, [needsMigration, containerBackfillKey, effectiveChangeDoc]);

	// Lift the active doc + handle into the cross-pane store so the right
	// inspector, history drawer, and presence overlays (which live in the
	// parent shell) can read and edit without a context provider snake.
	useEffect(() => {
		if (!doc || needsMigration) return;
		setActiveProjectDoc(projectId, doc, effectiveChangeDoc, handle ?? null);
	}, [doc, effectiveChangeDoc, handle, projectId, needsMigration]);
	useEffect(() => () => clearActiveProjectDoc(projectId), [projectId]);

	if (!doc || needsMigration) {
		return <CanvasLoading message="Loading document…" />;
	}

	// Canvas requires `changeDoc` to be a function (its drag/connect/auto-
	// layout effects all call into it). In mobile-readonly we substitute a
	// no-op so mutations silently drop — the toolbar add/delete actions are
	// already disabled via `projectDocStore.changeDoc === null` (every
	// caller reads through `getActiveDoc()` and bails).
	const canvasChangeDoc = mode === "mobile-readonly" ? () => {} : changeDoc;

	return (
		<div className="h-full">
			{handle && <PresenceBroadcaster projectId={projectId} handle={handle} />}
			<MobileOrDesktopViews
				projectId={projectId}
				doc={doc}
				changeDoc={canvasChangeDoc}
				view={view}
			/>
		</div>
	);
}

function MobileOrDesktopViews({
	projectId,
	doc,
	changeDoc,
	view,
}: {
	projectId: string;
	doc: PertProjectDoc;
	// biome-ignore lint/suspicious/noExplicitAny: changeDoc is Automerge's ChangeFn — the route type matches the rest of this file.
	changeDoc: any;
	view: ProjectView;
}) {
	const isMobile = useIsMobile();
	if (isMobile) {
		if (view === "table")
			return <TaskCardList projectId={projectId} doc={doc} />;
		if (view === "timeline")
			return <TimelineMobile projectId={projectId} doc={doc} />;
		if (view === "matrix")
			return <MatrixMobile projectId={projectId} doc={doc} />;
		// Network: same canvas as desktop, touch tweaks applied inside.
		return <PertCanvas projectId={projectId} doc={doc} changeDoc={changeDoc} />;
	}
	if (view === "table") return <TaskListView projectId={projectId} doc={doc} />;
	if (view === "timeline")
		return <TimelineView projectId={projectId} doc={doc} />;
	if (view === "matrix") return <MatrixView projectId={projectId} doc={doc} />;
	return <PertCanvas projectId={projectId} doc={doc} changeDoc={changeDoc} />;
}

function PresenceBroadcaster({
	projectId,
	handle,
}: {
	projectId: string;
	handle: DocHandle<PertProjectDoc>;
}) {
	const { data: session } = authClient.useSession();
	// Share-link recipients have no Better Auth session; the share landing
	// route writes their chosen display name + per-tab id into this store
	// instead. The signed-in session always wins when both are present
	// (someone signed in opening a link sees their own identity).
	const shareIdentity = useStore(shareIdentityStore);
	const userId = session?.user?.id ?? shareIdentity?.userId ?? "anonymous";
	const displayName =
		session?.user?.name ??
		session?.user?.email ??
		shareIdentity?.displayName ??
		null;
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

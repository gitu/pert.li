import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	ArrowUpFromLineIcon,
	CalendarDaysIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	GitBranchIcon,
	GridIcon,
	LinkIcon,
	ListIcon,
	NetworkIcon,
	PencilIcon,
	Share2Icon,
	SlidersHorizontalIcon,
	TimerIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	CopyDisplayToProjectsDialog,
	type CopyTargetProject,
} from "#/components/pert/copy-display-to-projects-dialog";
import { DisplaySettingsForm } from "#/components/pert/display-settings-form";
import { ExportProjectButton } from "#/components/pert/exchange/export-button";
import { IssueTrackerForm } from "#/components/pert/issue-tracker-form";
import { ProjectCalendarForm } from "#/components/pert/project-calendar-form";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { BranchProjectDialog } from "#/components/workspace/branch-project-dialog";
import { DeleteProjectDialog } from "#/components/workspace/delete-project-dialog";
import { PromoteBranchDialog } from "#/components/workspace/promote-branch-dialog";
import { ShareProjectDialog } from "#/components/workspace/share-project-dialog";
import { useOptionalRepo } from "#/lib/automerge/provider";
import {
	applyCalendar,
	type CalendarFormResult,
} from "#/lib/pert/apply-calendar";
import {
	applyDisplaySettings,
	type DisplayFormResult,
	writeDisplay,
} from "#/lib/pert/apply-display";
import {
	applyIssueTracker,
	type IssueTrackerFormResult,
} from "#/lib/pert/apply-issue-tracker";
import { DEFAULT_WORKING_DAYS, todayIsoDate } from "#/lib/pert/calendar";
import { changeWith } from "#/lib/pert/change-meta";
import {
	type ResolvedDisplaySettings,
	resolveDisplaySettings,
} from "#/lib/pert/display";
import {
	computeProjectOverview,
	type ProjectOverview,
} from "#/lib/pert/overview";
import { buildProjectDigest } from "#/lib/pert/overview-digest";
import { computeSchedule, type Schedule } from "#/lib/pert/schedule";
import { selectGroup } from "#/lib/pert/store";
import type { PertDoc, ProjectCalendar } from "#/lib/pert/types";
import { useViewMode } from "#/lib/view-mode";
import type { ProjectView } from "#/routes/_app/p.$projectId";
import { generateProjectSummary } from "#/server/ai-summary";
import {
	getProjectById,
	listProjects,
	updateProjectMeta,
} from "#/server/workspace";
import { MonteCarloForecast } from "./monte-carlo-forecast";
import { OverviewGroups } from "./overview-groups";
import { OverviewMetrics } from "./overview-metrics";
import {
	OverviewSummaryCard,
	type SummaryState,
} from "./overview-summary-card";

// One-line descriptions of each view, used by the jump-off cards.
const VIEW_JUMP_OFFS: Array<{
	id: Exclude<ProjectView, "overview">;
	label: string;
	intro: string;
	Icon: typeof NetworkIcon;
}> = [
	{
		id: "network",
		label: "Network",
		intro: "Dependency graph & critical path on an auto-laid-out canvas.",
		Icon: NetworkIcon,
	},
	{
		id: "timeline",
		label: "Timeline",
		intro: "Gantt-style schedule laid out by calendar date.",
		Icon: TimerIcon,
	},
	{
		id: "table",
		label: "Table",
		intro: "Sortable, filterable task table with inline editing.",
		Icon: ListIcon,
	},
	{
		id: "matrix",
		label: "Matrix",
		intro: "Dependency matrix — click a cell to toggle an edge.",
		Icon: GridIcon,
	},
];

// Container: wires the project meta query, the meta + summary mutations, the
// active doc store, and the route navigation, then renders the presentational
// OverviewContent. Same prop shape (projectId/doc/changeDoc) the other views
// get from MobileOrDesktopViews.
export function OverviewView({
	projectId,
	doc,
	changeDoc,
}: {
	projectId: string;
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const repo = useOptionalRepo();
	const { mode } = useViewMode();
	const readOnly = mode === "mobile-readonly";

	const { data: project } = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => getProjectById({ data: { projectId } }),
	});
	const { data: workspaceProjects } = useQuery({
		queryKey: ["projects", project?.workspaceId],
		queryFn: () =>
			listProjects({
				data: project?.workspaceId ? { workspaceId: project.workspaceId } : {},
			}),
		enabled: !!project?.workspaceId,
	});
	const existingBranchCount =
		workspaceProjects?.filter((p) => p.parentProjectId === projectId).length ??
		0;

	// Compute the CPM schedule once per doc change and share it: the project
	// rollup (computeProjectOverview) and the per-group rollups (OverviewGroups)
	// both need it, so passing it in avoids running the scheduler twice. Memoized
	// by doc so it doesn't re-run when only local UI state (dialogs, edit toggle)
	// changes.
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const schedule = scheduleResult.ok ? scheduleResult.schedule : null;
	const overview: ProjectOverview = useMemo(
		() => computeProjectOverview(doc, scheduleResult),
		[doc, scheduleResult],
	);

	const metaMutation = useMutation({
		mutationFn: (next: { title: string; description: string | null }) =>
			updateProjectMeta({
				data: {
					projectId,
					title: next.title,
					description: next.description,
				},
			}),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
				// Prefix key — invalidates every per-workspace ["projects", id]
				// list (sidebar, mobile sheet). Keying on project?.workspaceId
				// would miss them when the meta save races the project query.
				queryClient.invalidateQueries({ queryKey: ["projects"] }),
			]);
		},
	});

	const summarize = useMutation({
		mutationFn: () =>
			generateProjectSummary({
				data: { digest: buildProjectDigest(doc, overview) },
			}),
	});
	const summaryState: SummaryState = summarize.isPending
		? { status: "loading" }
		: summarize.isError
			? { status: "error", message: summaryError(summarize.error) }
			: summarize.data
				? { status: "done", text: summarize.data.summary }
				: { status: "idle" };

	const [shareOpen, setShareOpen] = useState(false);
	const [forkOpen, setForkOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [promoteOpen, setPromoteOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	const title = project?.title ?? doc.title ?? "Untitled project";
	const description = project?.description ?? null;
	const calendarInitial: ProjectCalendar = doc.calendar ?? {
		startDate: todayIsoDate(),
		workingDays: DEFAULT_WORKING_DAYS,
	};
	const issueTrackerInitial: IssueTrackerFormResult = {
		urlTemplate: doc.issueTracker?.urlTemplate ?? "",
		name: doc.issueTracker?.name,
	};

	// DISPLAY-SETTINGS: resolved current config seeds the form; the other live
	// projects in this workspace are the copy targets (exclude this one + any
	// archived).
	const displayInitial = useMemo(() => resolveDisplaySettings(doc), [doc]);
	const copyProjects: CopyTargetProject[] = (workspaceProjects ?? [])
		.filter((p) => p.id !== projectId && p.archivedAt == null)
		.map((p) => ({
			id: p.id,
			title: p.title,
			url: p.automergeDocUrl as string,
		}));

	// Fan the given display config out to the selected projects' docs. Resolves
	// the handles on demand (overview rows don't preload them) and writes via the
	// shared `writeDisplay` so the on-doc shape matches an in-place save exactly.
	// Targets are resolved in PARALLEL so the per-doc readiness wait is bounded by
	// the slowest single doc, not the sum — copying to many projects stays snappy
	// even when some of their docs haven't synced into this client yet.
	const copyDisplayToProjects = async (
		result: DisplayFormResult,
		targetUrls: string[],
	) => {
		if (!repo) {
			toast.error("Sync isn't ready yet — try again in a moment.");
			throw new Error("repo unavailable");
		}
		const results = await Promise.all(
			targetUrls.map(async (url) => {
				const handle = await repo.find<PertDoc>(url as AutomergeUrl, {
					allowableStates: ["ready", "unavailable"],
				});
				if (!handle.isReady()) {
					await Promise.race([
						handle.whenReady(["ready"]).catch(() => {}),
						new Promise((resolve) => setTimeout(resolve, 5000)),
					]);
				}
				// A doc that never synced into this client can't be written — skip it.
				if (!handle.doc()) return false;
				changeWith(handle, "user", (d) => writeDisplay(d, result));
				return true;
			}),
		);
		const copied = results.filter(Boolean).length;
		if (copied === 0) {
			toast.error("Couldn't load the selected projects to copy to.");
			throw new Error("no projects copied");
		}
		toast.success(
			`Display settings copied to ${copied} project${copied === 1 ? "" : "s"}`,
		);
	};

	const actions: ReactNode = (
		<>
			<ExportProjectButton doc={doc} className="h-8 gap-1.5 text-xs" />
			{!readOnly && (
				<>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 gap-1.5 text-xs"
						onClick={() => setShareOpen(true)}
						data-testid="overview-share"
						title="Share this project"
					>
						<Share2Icon className="size-3.5" />
						Share
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 gap-1.5 text-xs"
						onClick={() => setRenameOpen(true)}
						data-testid="overview-edit"
						title="Edit title & description"
						disabled={!project}
					>
						<PencilIcon className="size-3.5" />
						Edit
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 gap-1.5 text-xs"
						onClick={() => setForkOpen(true)}
						data-testid="overview-branch-action"
						title="Branch this plan"
						disabled={!project}
					>
						<GitBranchIcon className="size-3.5" />
						Branch
					</Button>
					{project?.parentProjectId != null && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-8 gap-1.5 text-xs"
							onClick={() => setPromoteOpen(true)}
							data-testid="overview-promote-action"
							title="Promote to standalone plan"
						>
							<ArrowUpFromLineIcon className="size-3.5" />
							Promote
						</Button>
					)}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
						onClick={() => setDeleteOpen(true)}
						data-testid="overview-delete"
						title="Delete this project"
						disabled={!project}
					>
						<Trash2Icon className="size-3.5" />
						Delete
					</Button>
				</>
			)}
			<ShareProjectDialog
				projectId={projectId}
				open={shareOpen}
				onOpenChange={setShareOpen}
			/>
			{project && forkOpen && (
				<BranchProjectDialog
					mode="fork"
					open={forkOpen}
					onOpenChange={setForkOpen}
					parent={{ id: project.id, title: project.title }}
					existingBranchCount={existingBranchCount}
				/>
			)}
			{project && renameOpen && (
				<BranchProjectDialog
					mode="edit"
					open={renameOpen}
					onOpenChange={setRenameOpen}
					project={{
						id: project.id,
						title: project.title,
						description: project.description,
						isBranch: project.parentProjectId != null,
					}}
				/>
			)}
			{project && promoteOpen && (
				<PromoteBranchDialog
					open={promoteOpen}
					onOpenChange={setPromoteOpen}
					project={{ id: project.id, title: project.title }}
				/>
			)}
			{project && deleteOpen && (
				<DeleteProjectDialog
					project={{
						id: project.id,
						title: project.title,
						hasBranches: existingBranchCount > 0,
					}}
					open={deleteOpen}
					onOpenChange={setDeleteOpen}
					onDeleted={() => navigate({ to: "/" })}
				/>
			)}
		</>
	);

	return (
		<OverviewContent
			title={title}
			description={description}
			overview={overview}
			doc={doc}
			schedule={schedule}
			readOnly={readOnly}
			metaSaving={metaMutation.isPending}
			// mutateAsync so the editor can await the result and keep itself open
			// (showing the error) when the save fails.
			onSaveMeta={(next) => metaMutation.mutateAsync(next)}
			calendarInitial={calendarInitial}
			onSaveCalendar={(next) => {
				applyCalendar(changeDoc, next);
				toast.success("Calendar & scheduling saved");
			}}
			displayInitial={displayInitial}
			onSaveDisplay={(next) => {
				applyDisplaySettings(changeDoc, next);
				toast.success("Display settings saved");
			}}
			copyProjects={copyProjects}
			onCopyDisplay={copyDisplayToProjects}
			issueTrackerInitial={issueTrackerInitial}
			onSaveIssueTracker={(next) => {
				applyIssueTracker(changeDoc, next);
				toast.success("Issue tracker saved");
			}}
			summaryState={summaryState}
			onSummarize={() => summarize.mutate()}
			onNavigate={(view) =>
				navigate({
					to: "/p/$projectId",
					params: { projectId },
					search: { view },
				})
			}
			onSelectGroup={(groupId) => {
				// Drill into the group: select it, then jump to the Network canvas
				// where the selection (and the group box) is visible + inspectable.
				selectGroup(projectId, groupId);
				navigate({
					to: "/p/$projectId",
					params: { projectId },
					search: { view: "network" },
				});
			}}
			actions={actions}
		/>
	);
}

function summaryError(error: unknown): string {
	const msg = error instanceof Error ? error.message : "";
	if (/no llm provider|api key|provider/i.test(msg)) {
		return "No AI provider is configured on the server.";
	}
	return msg || "Couldn't generate a summary. Try again.";
}

export type OverviewContentProps = {
	title: string;
	description: string | null;
	overview: ProjectOverview;
	doc: PertDoc;
	// Precomputed CPM schedule (shared with `overview`) for the per-group rollups.
	schedule: Schedule | null;
	readOnly: boolean;
	metaSaving: boolean;
	onSaveMeta: (next: {
		title: string;
		description: string | null;
	}) => void | Promise<unknown>;
	calendarInitial: ProjectCalendar;
	onSaveCalendar: (next: CalendarFormResult) => void;
	// DISPLAY-SETTINGS
	displayInitial: ResolvedDisplaySettings;
	onSaveDisplay: (next: DisplayFormResult) => void;
	// Other live projects in the workspace, available as copy targets.
	copyProjects: CopyTargetProject[];
	onCopyDisplay: (
		result: DisplayFormResult,
		targetUrls: string[],
	) => Promise<void>;
	issueTrackerInitial: IssueTrackerFormResult;
	onSaveIssueTracker: (next: IssueTrackerFormResult) => void;
	summaryState: SummaryState;
	onSummarize: () => void;
	onNavigate: (view: Exclude<ProjectView, "overview">) => void;
	onSelectGroup: (groupId: string) => void;
	actions?: ReactNode;
};

// Pure presentation — no queries / store / router. Stories drive every state.
export function OverviewContent({
	title,
	description,
	overview,
	doc,
	schedule,
	readOnly,
	metaSaving,
	onSaveMeta,
	calendarInitial,
	onSaveCalendar,
	displayInitial,
	onSaveDisplay,
	copyProjects,
	onCopyDisplay,
	issueTrackerInitial,
	onSaveIssueTracker,
	summaryState,
	onSummarize,
	onNavigate,
	onSelectGroup,
	actions,
}: OverviewContentProps) {
	// Bump to re-seed the calendar form (Cancel / after Save) from props.
	const [calendarKey, setCalendarKey] = useState(0);
	// The calendar settings are the calculation basis behind the forecast — shown
	// below it and collapsed by default so the finish-date result leads.
	const [basisOpen, setBasisOpen] = useState(false);
	// Mount the form lazily on first expand, then keep it mounted (just hidden)
	// so collapsing mid-edit doesn't unmount it and silently drop unsaved edits.
	const [basisMounted, setBasisMounted] = useState(false);
	// Issue-tracker settings panel — same collapse/lazy-mount/re-seed pattern as
	// the calendar basis above.
	const [trackerKey, setTrackerKey] = useState(0);
	const [trackerOpen, setTrackerOpen] = useState(false);
	const [trackerMounted, setTrackerMounted] = useState(false);

	// DISPLAY-SETTINGS: same collapse / lazy-mount / re-seed triple as the
	// calendar basis above. The copy dialog opens from inside the form, carrying
	// the on-screen settings up to the container's cross-doc writer.
	const [displayKey, setDisplayKey] = useState(0);
	const [displayOpen, setDisplayOpen] = useState(false);
	const [displayMounted, setDisplayMounted] = useState(false);
	const [copyOpen, setCopyOpen] = useState(false);
	const [copyResult, setCopyResult] = useState<DisplayFormResult | null>(null);

	return (
		<div className="h-full overflow-y-auto" data-testid="overview-view">
			<div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
				{/* Header: title & description on the left, project actions on the right */}
				<header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 flex-1">
						<ProjectDescription
							title={title}
							description={description}
							readOnly={readOnly}
							saving={metaSaving}
							onSave={onSaveMeta}
						/>
					</div>
					{actions && (
						<div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
							{actions}
						</div>
					)}
				</header>

				{/* View jump-offs — compact strip up top so the views are one click away */}
				<section data-testid="overview-explore">
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{VIEW_JUMP_OFFS.map((v) => (
							<button
								key={v.id}
								type="button"
								onClick={() => onNavigate(v.id)}
								data-testid={`overview-jump-${v.id}`}
								// title gives sighted mouse users a hover tooltip; aria-label
								// carries the same intro to keyboard/AT users on focus, since
								// the compact strip no longer renders the intro as visible text.
								title={v.intro}
								aria-label={`${v.label}: ${v.intro}`}
								className="group flex items-center gap-2 rounded-md border bg-card/40 px-3 py-2 text-left transition-colors hover:border-brand/50 hover:bg-brand/5"
							>
								<v.Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-brand" />
								<span className="min-w-0 flex-1 truncate text-sm font-medium">
									{v.label}
								</span>
								<ArrowRightIcon className="size-3.5 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
							</button>
						))}
					</div>
				</section>

				{/* Key figures */}
				<OverviewMetrics overview={overview} />

				{/* Dashboard grid: AI summary on the left, calendar on the right */}
				<div className="grid items-start gap-6 lg:grid-cols-2">
					{/* AI summary */}
					<div className="lg:col-start-1 lg:row-start-1">
						<OverviewSummaryCard
							state={summaryState}
							onSummarize={onSummarize}
							disabled={readOnly}
						/>
					</div>

					{/* Calendar & scheduling: forecast first, calendar settings
					    (the calculation basis) collapsed below it. */}
					<section className="rounded-md border bg-card/40 lg:col-start-2 lg:row-start-1">
						<div className="flex items-center gap-1.5 border-b px-4 py-3 text-sm font-medium">
							<CalendarDaysIcon className="size-4" />
							Calendar &amp; scheduling
						</div>
						{/* Read-only forecast — shown in both edit and read-only modes. */}
						<MonteCarloForecast doc={doc} />
						{/* Calculation basis — the project calendar the schedule is
						    computed from. Collapsed by default. */}
						<div className="border-t">
							<button
								type="button"
								onClick={() => {
									if (!basisOpen) setBasisMounted(true);
									setBasisOpen((open) => !open);
								}}
								aria-expanded={basisOpen}
								title={
									basisOpen
										? "Hide calendar settings"
										: "Show calendar settings"
								}
								data-testid="calendar-basis-toggle"
								className="flex w-full items-center gap-1.5 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50"
							>
								{basisOpen ? (
									<ChevronDownIcon className="size-3 shrink-0" />
								) : (
									<ChevronRightIcon className="size-3 shrink-0" />
								)}
								Calendar settings
								<span className="ml-1 text-xs font-normal text-muted-foreground">
									Calculation basis
								</span>
							</button>
							{/* Mounted on first expand, then kept mounted but hidden when
							    collapsed so unsaved calendar edits survive a collapse. */}
							{basisMounted && (
								<div hidden={!basisOpen}>
									{readOnly ? (
										<p className="px-4 pb-4 text-xs text-muted-foreground">
											Switch to edit mode to change the project calendar.
										</p>
									) : (
										<ProjectCalendarForm
											key={calendarKey}
											initial={calendarInitial}
											doc={doc}
											onCancel={() => setCalendarKey((k) => k + 1)}
											onSave={(next) => {
												onSaveCalendar(next);
												setCalendarKey((k) => k + 1);
											}}
										/>
									)}
								</div>
							)}
						</div>
					</section>
				</div>

				{/* DISPLAY-SETTINGS: per-project display config for the Groups list
				    below + the Network nodes. Collapsed by default; same pattern as
				    the calendar basis. */}
				<section className="rounded-md border bg-card/40">
					<button
						type="button"
						onClick={() => {
							if (!displayOpen) setDisplayMounted(true);
							setDisplayOpen((open) => !open);
						}}
						aria-expanded={displayOpen}
						title={
							displayOpen ? "Hide display settings" : "Show display settings"
						}
						data-testid="display-settings-toggle"
						className="flex w-full items-center gap-1.5 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50"
					>
						{displayOpen ? (
							<ChevronDownIcon className="size-3 shrink-0" />
						) : (
							<ChevronRightIcon className="size-3 shrink-0" />
						)}
						<SlidersHorizontalIcon className="size-4" />
						Display settings
						<span className="ml-1 text-xs font-normal text-muted-foreground">
							Fields & density for Groups + Network
						</span>
					</button>
					{displayMounted && (
						<div hidden={!displayOpen} className="border-t">
							{readOnly ? (
								<p className="px-4 py-4 text-xs text-muted-foreground">
									Switch to edit mode to change display settings.
								</p>
							) : (
								<DisplaySettingsForm
									key={displayKey}
									initial={displayInitial}
									onCancel={() => setDisplayKey((k) => k + 1)}
									onSave={(next) => {
										onSaveDisplay(next);
										setDisplayKey((k) => k + 1);
									}}
									onCopyToProjects={
										copyProjects.length > 0
											? (current) => {
													setCopyResult(current);
													setCopyOpen(true);
												}
											: undefined
									}
								/>
							)}
						</div>
					)}
				</section>
				{!readOnly && (
					<CopyDisplayToProjectsDialog
						open={copyOpen}
						onOpenChange={setCopyOpen}
						projects={copyProjects}
						onCopy={async (urls) => {
							if (copyResult) await onCopyDisplay(copyResult, urls);
						}}
					/>
				)}

				{/* Issue tracker: project-level URL template that turns each task's
				    issue keys into click-through links. Collapsed by default. */}
				<section className="rounded-md border bg-card/40">
					<button
						type="button"
						onClick={() => {
							if (!trackerOpen) setTrackerMounted(true);
							setTrackerOpen((open) => !open);
						}}
						aria-expanded={trackerOpen}
						title={trackerOpen ? "Hide issue tracker" : "Show issue tracker"}
						data-testid="issue-tracker-toggle"
						className="flex w-full items-center gap-1.5 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50"
					>
						{trackerOpen ? (
							<ChevronDownIcon className="size-3 shrink-0" />
						) : (
							<ChevronRightIcon className="size-3 shrink-0" />
						)}
						<LinkIcon className="size-4" />
						Issue tracker
						<span className="ml-1 text-xs font-normal text-muted-foreground">
							{doc.issueTracker?.urlTemplate
								? (doc.issueTracker.name ?? "Configured")
								: "Link tasks to Jira & similar"}
						</span>
					</button>
					{trackerMounted && (
						<div hidden={!trackerOpen} className="border-t">
							{readOnly ? (
								<p className="px-4 py-4 text-xs text-muted-foreground">
									Switch to edit mode to configure the issue tracker.
								</p>
							) : (
								<IssueTrackerForm
									key={trackerKey}
									initial={issueTrackerInitial}
									onCancel={() => setTrackerKey((k) => k + 1)}
									onSave={(next) => {
										onSaveIssueTracker(next);
										setTrackerKey((k) => k + 1);
									}}
								/>
							)}
						</div>
					)}
				</section>

				{/* All groups at a glance — rollups + drill-in. */}
				<OverviewGroups
					doc={doc}
					schedule={schedule}
					onSelect={onSelectGroup}
				/>
			</div>
		</div>
	);
}

function ProjectDescription({
	title,
	description,
	readOnly,
	saving,
	onSave,
}: {
	title: string;
	description: string | null;
	readOnly: boolean;
	saving: boolean;
	onSave: (next: { title: string; description: string | null }) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(title);
	const [draftDescription, setDraftDescription] = useState(description ?? "");
	const [error, setError] = useState<string | null>(null);

	const startEdit = () => {
		setDraftTitle(title);
		setDraftDescription(description ?? "");
		setError(null);
		setEditing(true);
	};

	if (editing) {
		const trimmed = draftTitle.trim();
		return (
			<section className="space-y-2" data-testid="overview-description-edit">
				<Input
					value={draftTitle}
					onChange={(e) => setDraftTitle(e.target.value)}
					maxLength={120}
					placeholder="Project title"
					aria-label="Project title"
					data-testid="overview-title-input"
				/>
				<Textarea
					value={draftDescription}
					onChange={(e) => setDraftDescription(e.target.value)}
					maxLength={500}
					rows={3}
					placeholder="Describe this project — its goal, scope, constraints…"
					aria-label="Project description"
					data-testid="overview-description-input"
				/>
				<div className="flex items-center gap-1.5">
					<Button
						type="button"
						size="sm"
						className="h-8 gap-1.5 text-xs"
						disabled={saving || trimmed.length === 0}
						onClick={async () => {
							setError(null);
							try {
								// Await so a failed save keeps the editor open (with the
								// draft intact) instead of silently dropping the edit.
								await onSave({
									title: trimmed,
									description: draftDescription.trim() || null,
								});
								setEditing(false);
							} catch (e) {
								setError(
									e instanceof Error && e.message
										? e.message
										: "Couldn't save. Please try again.",
								);
							}
						}}
						data-testid="overview-description-save"
					>
						<CheckIcon className="size-3.5" />
						Save
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 gap-1.5 text-xs"
						onClick={() => {
							setError(null);
							setEditing(false);
						}}
					>
						<XIcon className="size-3.5" />
						Cancel
					</Button>
				</div>
				{error && (
					<p
						className="text-xs text-destructive"
						data-testid="overview-description-error"
					>
						{error}
					</p>
				)}
			</section>
		);
	}

	return (
		<section className="space-y-1" data-testid="overview-description">
			<div className="flex items-center gap-1.5">
				<h1 className="text-xl font-semibold">{title}</h1>
				{!readOnly && (
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-7 shrink-0 text-muted-foreground"
						onClick={startEdit}
						data-testid="overview-description-edit-button"
						title="Rename & edit description"
						aria-label="Rename & edit description"
					>
						<PencilIcon className="size-3.5" />
					</Button>
				)}
			</div>
			{description ? (
				<p className="whitespace-pre-wrap text-sm text-muted-foreground">
					{description}
				</p>
			) : (
				<p className="text-sm italic text-muted-foreground">
					{readOnly
						? "No description."
						: "No description yet — add one to give collaborators context."}
				</p>
			)}
		</section>
	);
}

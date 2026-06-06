import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	ArrowUpFromLineIcon,
	CalendarDaysIcon,
	CheckIcon,
	GitBranchIcon,
	GridIcon,
	ListIcon,
	NetworkIcon,
	PencilIcon,
	Share2Icon,
	TimerIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ExportProjectButton } from "#/components/pert/exchange/export-button";
import { ProjectCalendarForm } from "#/components/pert/project-calendar-form";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { BranchProjectDialog } from "#/components/workspace/branch-project-dialog";
import { PromoteBranchDialog } from "#/components/workspace/promote-branch-dialog";
import { ShareProjectDialog } from "#/components/workspace/share-project-dialog";
import {
	applyCalendar,
	type CalendarFormResult,
} from "#/lib/pert/apply-calendar";
import { DEFAULT_WORKING_DAYS, todayIsoDate } from "#/lib/pert/calendar";
import {
	computeProjectOverview,
	type ProjectOverview,
} from "#/lib/pert/overview";
import { buildProjectDigest } from "#/lib/pert/overview-digest";
import type { PertDoc, ProjectCalendar } from "#/lib/pert/types";
import { useViewMode } from "#/lib/view-mode";
import type { ProjectView } from "#/routes/_app/p.$projectId";
import { generateProjectSummary } from "#/server/ai-summary";
import {
	getProjectById,
	listProjects,
	updateProjectMeta,
} from "#/server/workspace";
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

	// Memoize by doc — computeProjectOverview runs the CPM scheduler, so we
	// don't want it re-running when only local UI state (dialogs, edit toggle)
	// changes. Matches the useMemo(computeSchedule) pattern in the other views.
	const overview: ProjectOverview = useMemo(
		() => computeProjectOverview(doc),
		[doc],
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

	const title = project?.title ?? doc.title ?? "Untitled project";
	const description = project?.description ?? null;
	const calendarInitial: ProjectCalendar = doc.calendar ?? {
		startDate: todayIsoDate(),
		workingDays: DEFAULT_WORKING_DAYS,
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
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-8 gap-1.5 text-xs"
								data-testid="overview-branch-menu"
								title="Branch / rename"
							>
								<GitBranchIcon className="size-3.5" />
								Branch
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onSelect={() => setForkOpen(true)}
								data-testid="overview-branch-action"
								disabled={!project}
							>
								<GitBranchIcon className="size-3.5" />
								Branch this plan
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => setRenameOpen(true)}
								data-testid="overview-rename-action"
								disabled={!project}
							>
								<PencilIcon className="size-3.5" />
								Rename / edit description
							</DropdownMenuItem>
							{project?.parentProjectId != null && (
								<DropdownMenuItem
									onSelect={() => setPromoteOpen(true)}
									data-testid="overview-promote-action"
								>
									<ArrowUpFromLineIcon className="size-3.5" />
									Promote to standalone plan
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
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
		</>
	);

	return (
		<OverviewContent
			title={title}
			description={description}
			overview={overview}
			doc={doc}
			readOnly={readOnly}
			metaSaving={metaMutation.isPending}
			// mutateAsync so the editor can await the result and keep itself open
			// (showing the error) when the save fails.
			onSaveMeta={(next) => metaMutation.mutateAsync(next)}
			calendarInitial={calendarInitial}
			onSaveCalendar={(next) => applyCalendar(changeDoc, next)}
			summaryState={summaryState}
			onSummarize={() => summarize.mutate()}
			onNavigate={(view) =>
				navigate({
					to: "/p/$projectId",
					params: { projectId },
					search: { view },
				})
			}
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
	readOnly: boolean;
	metaSaving: boolean;
	onSaveMeta: (next: {
		title: string;
		description: string | null;
	}) => void | Promise<unknown>;
	calendarInitial: ProjectCalendar;
	onSaveCalendar: (next: CalendarFormResult) => void;
	summaryState: SummaryState;
	onSummarize: () => void;
	onNavigate: (view: Exclude<ProjectView, "overview">) => void;
	actions?: ReactNode;
};

// Pure presentation — no queries / store / router. Stories drive every state.
export function OverviewContent({
	title,
	description,
	overview,
	doc,
	readOnly,
	metaSaving,
	onSaveMeta,
	calendarInitial,
	onSaveCalendar,
	summaryState,
	onSummarize,
	onNavigate,
	actions,
}: OverviewContentProps) {
	// Bump to re-seed the calendar form (Cancel / after Save) from props.
	const [calendarKey, setCalendarKey] = useState(0);

	return (
		<div className="h-full overflow-y-auto" data-testid="overview-view">
			<div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
				{/* Description / title */}
				<ProjectDescription
					title={title}
					description={description}
					readOnly={readOnly}
					saving={metaSaving}
					onSave={onSaveMeta}
				/>

				{/* Key figures */}
				<OverviewMetrics overview={overview} />

				{/* AI summary */}
				<OverviewSummaryCard state={summaryState} onSummarize={onSummarize} />

				{/* Project actions */}
				{actions && (
					<section className="rounded-md border bg-card/40 p-4">
						<h2 className="mb-2 text-sm font-medium">Project actions</h2>
						<div className="flex flex-wrap items-center gap-1.5">{actions}</div>
					</section>
				)}

				{/* Calendar settings */}
				<section className="rounded-md border bg-card/40">
					<div className="flex items-center gap-1.5 border-b px-4 py-3 text-sm font-medium">
						<CalendarDaysIcon className="size-4" />
						Calendar &amp; scheduling
					</div>
					{readOnly ? (
						<p className="p-4 text-xs text-muted-foreground">
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
				</section>

				{/* View jump-offs */}
				<section>
					<h2 className="mb-2 text-sm font-medium">Explore this project</h2>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{VIEW_JUMP_OFFS.map((v) => (
							<button
								key={v.id}
								type="button"
								onClick={() => onNavigate(v.id)}
								data-testid={`overview-jump-${v.id}`}
								className="group flex items-start gap-3 rounded-md border bg-card/40 p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand/5"
							>
								<v.Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-brand" />
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-1 text-sm font-medium">
										{v.label}
										<ArrowRightIcon className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
									</div>
									<div className="text-xs text-muted-foreground">{v.intro}</div>
								</div>
							</button>
						))}
					</div>
				</section>
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
			<div className="flex items-start justify-between gap-3">
				<h1 className="text-xl font-semibold">{title}</h1>
				{!readOnly && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 shrink-0 gap-1.5 text-xs"
						onClick={startEdit}
						data-testid="overview-description-edit-button"
					>
						<PencilIcon className="size-3.5" />
						Edit
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

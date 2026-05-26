import { useStore } from "@tanstack/react-store";
import {
	CheckCircle2Icon,
	CircleDotIcon,
	CircleIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConflictPill } from "#/components/pert/inspector/conflict-pill";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Progress } from "#/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import { Slider } from "#/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import {
	addDependencyMutation,
	addTaskMutation,
	moveTaskMutation,
	removeTaskMutation,
} from "#/lib/ai/tool-mutators";
import { todayIsoDate } from "#/lib/pert/calendar";
import { getChildren, getDescendants } from "#/lib/pert/hierarchy";
import type { MonteCarloResult } from "#/lib/pert/montecarlo";
import { rollupContainer, rollupContainerPaths } from "#/lib/pert/projection";
import { readTaskConflicts } from "#/lib/pert/read-conflicts";
import { computeSchedule, type TaskSchedule } from "#/lib/pert/schedule";
import { projectDocStore, selectionStore } from "#/lib/pert/store";
import type {
	Estimate,
	PertDoc,
	Task,
	TaskId,
	TaskKind,
	TaskStatus,
} from "#/lib/pert/types";
import { useMonteCarlo } from "#/lib/pert/use-monte-carlo";

// Right-pane editor for the currently selected task. Subscribes to two
// stores: which task is selected, and which project's doc is active. Reads
// the engine output too so callers see the live ES/EF/slack derived from
// their own edits — Automerge's local mutations are synchronous, so there's
// no latency hiding the round-trip.

// In read-only mode the project store carries `changeDoc === null` (set by
// the mobile shell when view-mode === "mobile-readonly"). The inspector
// still has a doc + projectId, so it must render the task data — just
// route every would-be mutation through a no-op so the existing edit
// chrome doesn't crash. A banner at the top of the form announces the
// read-only state and points at the pencil toggle.
const noopChangeDoc: (mutate: (d: PertDoc) => void) => void = () => {};

// One of the three inspector panes. `RightTabs` in `_app.tsx` hoists these to
// top-level tabs (alongside History); the mobile sheet and fullscreen popup
// pass no `pane` and get the bundled 3-tab UI rendered internally.
export type InspectorPane = "details" | "plan" | "track";

export function TaskInspector({ pane }: { pane?: InspectorPane } = {}) {
	const selection = useStore(selectionStore);
	const { doc, changeDoc, projectId } = useStore(projectDocStore);
	const mc = useMonteCarlo(doc, { trials: 1500 });

	if (!doc || !projectId) {
		return <EmptyState message="Open a project to edit tasks." />;
	}
	if (selection.projectId !== projectId || !selection.taskId) {
		return (
			<EmptyState message="Select a task to edit its estimate, dependencies, and notes." />
		);
	}
	const task = doc.tasksById[selection.taskId];
	if (!task) {
		return <EmptyState message="The selected task has been removed." />;
	}
	const readOnly = !changeDoc;
	const safeChangeDoc = changeDoc ?? noopChangeDoc;
	const conflicts = readTaskConflicts(doc, task.id);
	const conflictPill = conflicts ? (
		<ConflictPill
			conflicts={conflicts}
			taskId={task.id}
			onResolve={safeChangeDoc}
		/>
	) : null;
	const onDelete = () => {
		if (readOnly) return;
		safeChangeDoc((d) => {
			removeTaskMutation(d, { taskId: task.id });
		});
		// Clear selection so the inspector falls back to its empty state instead
		// of showing "the selected task has been removed."
		selectionStore.setState((s) => ({ ...s, taskId: null }));
	};
	const renderPane = (p: InspectorPane) =>
		task.kind === "container" ? (
			<ContainerForm
				key={`${task.id}-${p}`}
				task={task}
				doc={doc}
				changeDoc={safeChangeDoc}
				projectId={projectId}
				conflictPill={conflictPill}
				onDelete={onDelete}
				mcResult={mc.result}
				pane={p}
			/>
		) : (
			<TaskForm
				key={`${task.id}-${p}`}
				task={task}
				doc={doc}
				changeDoc={safeChangeDoc}
				projectId={projectId}
				scheduleResult={computeSchedule(doc)}
				conflictPill={conflictPill}
				mcResult={mc.result}
				onMutate={(mutate) =>
					safeChangeDoc((d) => {
						const draft = d.tasksById[task.id];
						if (draft) mutate(draft);
					})
				}
				onDelete={onDelete}
				pane={p}
			/>
		);

	const body = pane ? (
		renderPane(pane)
	) : (
		<Tabs
			defaultValue="details"
			className="flex h-full min-h-0 flex-col gap-0"
			data-testid="inspector-tabs"
		>
			<div className="shrink-0 border-b bg-card/40 px-2 py-1.5">
				<TabsList variant="line" className="w-full">
					<TabsTrigger
						value="details"
						data-testid="inspector-tab-details"
						className="text-xs"
					>
						Details
					</TabsTrigger>
					<TabsTrigger
						value="plan"
						data-testid="inspector-tab-plan"
						className="text-xs"
					>
						Plan
					</TabsTrigger>
					<TabsTrigger
						value="track"
						data-testid="inspector-tab-track"
						className="text-xs"
					>
						Track
					</TabsTrigger>
				</TabsList>
			</div>
			<TabsContent
				value="details"
				className="mt-0 min-h-0 flex-1 overflow-auto"
			>
				{renderPane("details")}
			</TabsContent>
			<TabsContent value="plan" className="mt-0 min-h-0 flex-1 overflow-auto">
				{renderPane("plan")}
			</TabsContent>
			<TabsContent value="track" className="mt-0 min-h-0 flex-1 overflow-auto">
				{renderPane("track")}
			</TabsContent>
		</Tabs>
	);
	if (!readOnly) return body;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="inspector-readonly-banner"
				className="shrink-0 border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"
			>
				View only — tap the pencil in the top bar to edit.
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">{body}</div>
		</div>
	);
}

function EmptyState({ message }: { message: string }) {
	return (
		<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
			<p>{message}</p>
		</div>
	);
}

type ScheduleResult = ReturnType<typeof computeSchedule>;

function TaskForm({
	task,
	doc,
	changeDoc,
	projectId,
	scheduleResult,
	conflictPill,
	mcResult,
	onMutate,
	onDelete,
	pane,
}: {
	task: Task;
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	projectId: string;
	scheduleResult: ScheduleResult;
	conflictPill?: React.ReactNode;
	mcResult: MonteCarloResult | null;
	onMutate: (mutate: (draft: Task) => void) => void;
	onDelete: () => void;
	pane: InspectorPane;
}) {
	const sched = scheduleResult.ok
		? scheduleResult.schedule.tasks[task.id]
		: null;
	const mcTask = mcResult?.tasks[task.id] ?? null;

	const setTitle = useCallback(
		(value: string) =>
			onMutate((d) => {
				d.title = value;
			}),
		[onMutate],
	);
	const setNotes = useCallback(
		(value: string) =>
			onMutate((d) => {
				d.notes = value;
			}),
		[onMutate],
	);
	const setKey = useCallback(
		(value: string) =>
			onMutate((d) => {
				const trimmed = value.trim();
				if (trimmed.length === 0) delete d.key;
				else d.key = trimmed;
			}),
		[onMutate],
	);
	const setKind = useCallback(
		(kind: TaskKind) =>
			onMutate((d) => {
				d.kind = kind;
				if (kind === "milestone") delete d.estimate;
				if (kind === "task" && !d.estimate) {
					d.estimate = {
						optimistic: 1,
						mostLikely: 2,
						pessimistic: 4,
						unit: "day",
					};
				}
			}),
		[onMutate],
	);
	const setEstimateField = useCallback(
		(
			field: keyof Pick<Estimate, "optimistic" | "mostLikely" | "pessimistic">,
			value: number,
		) =>
			onMutate((d) => {
				if (!d.estimate) {
					d.estimate = {
						optimistic: 1,
						mostLikely: 2,
						pessimistic: 4,
						unit: "day",
					};
				}
				d.estimate[field] = value;
			}),
		[onMutate],
	);
	const setEstimateUnit = useCallback(
		(unit: Estimate["unit"]) =>
			onMutate((d) => {
				if (!d.estimate) return;
				d.estimate.unit = unit;
			}),
		[onMutate],
	);
	const setStatus = useCallback(
		(status: TaskStatus) =>
			onMutate((d) => {
				const today = todayIsoDate();
				d.status = status;
				if (status === "not_started") {
					delete d.progress;
					delete d.actualStart;
					delete d.actualFinish;
				} else if (status === "in_progress") {
					if (typeof d.progress !== "number") d.progress = 0;
					if (!d.actualStart) d.actualStart = today;
					delete d.actualFinish;
				} else if (status === "completed") {
					d.progress = 100;
					if (!d.actualStart) d.actualStart = today;
					d.actualFinish = today;
				}
			}),
		[onMutate],
	);
	const setProgress = useCallback(
		(value: number) =>
			onMutate((d) => {
				const clamped = Math.max(0, Math.min(100, Math.round(value)));
				d.progress = clamped;
				if (d.status !== "in_progress" && d.status !== "completed") {
					d.status = "in_progress";
					if (!d.actualStart) d.actualStart = todayIsoDate();
				}
				if (clamped >= 100) {
					d.status = "completed";
					d.actualFinish = todayIsoDate();
				} else if (d.status === "completed") {
					d.status = "in_progress";
					delete d.actualFinish;
				}
			}),
		[onMutate],
	);
	const setActualStart = useCallback(
		(next: string | undefined) =>
			onMutate((d) => {
				if (next) d.actualStart = next;
				else delete d.actualStart;
			}),
		[onMutate],
	);
	const setActualFinish = useCallback(
		(next: string | undefined) =>
			onMutate((d) => {
				if (next) d.actualFinish = next;
				else delete d.actualFinish;
			}),
		[onMutate],
	);

	const status: TaskStatus = task.status ?? "not_started";
	const progressValue =
		status === "completed"
			? 100
			: status === "in_progress"
				? (task.progress ?? 0)
				: 0;

	const planView = (
		<div className="@container p-4">
			{conflictPill && <div className="mb-4">{conflictPill}</div>}
			<TaskSummary task={task} sched={sched} mcTask={mcTask} />

			{/* Two-column layout above lg (1024px); single column below so the
			    inspector stays usable inside the narrow bottom panel on small
			    screens. The right column is purely informational, so it can
			    safely sit lower in the source order on mobile. */}
			<div className="mt-4 grid grid-cols-1 gap-4 @4xl:grid-cols-2 @4xl:gap-6">
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="ti-title">Title</Label>
						<Input
							id="ti-title"
							data-testid="inspector-title"
							value={task.title}
							onChange={(e) => setTitle(e.target.value)}
						/>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="ti-key">
							Key{" "}
							<span className="text-muted-foreground/70">
								— dotted group, e.g. M1.A
							</span>
						</Label>
						<Input
							id="ti-key"
							data-testid="inspector-key"
							value={task.key ?? ""}
							onChange={(e) => setKey(e.target.value)}
							placeholder="ungrouped"
							className="font-mono text-xs"
						/>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="ti-kind">Kind</Label>
						<Select
							value={task.kind}
							onValueChange={(v) => setKind(v as TaskKind)}
						>
							<SelectTrigger id="ti-kind">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="task">Task</SelectItem>
								<SelectItem value="milestone">Milestone</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{task.kind !== "milestone" && (
						<div className="space-y-2">
							<Label className="block text-xs">PERT estimate</Label>
							<div className="grid grid-cols-3 gap-2">
								<EstimateField
									label="Optimistic"
									id="ti-o"
									value={task.estimate?.optimistic ?? 0}
									onChange={(v) => setEstimateField("optimistic", v)}
								/>
								<EstimateField
									label="Most likely"
									id="ti-m"
									value={task.estimate?.mostLikely ?? 0}
									onChange={(v) => setEstimateField("mostLikely", v)}
								/>
								<EstimateField
									label="Pessimistic"
									id="ti-p"
									value={task.estimate?.pessimistic ?? 0}
									onChange={(v) => setEstimateField("pessimistic", v)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="ti-unit" className="text-xs">
									Unit
								</Label>
								<Select
									value={task.estimate?.unit ?? "day"}
									onValueChange={(v) => setEstimateUnit(v as Estimate["unit"])}
								>
									<SelectTrigger id="ti-unit">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="hour">Hours</SelectItem>
										<SelectItem value="day">Days</SelectItem>
										<SelectItem value="week">Weeks</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					)}

					<div className="space-y-1.5">
						<Label htmlFor="ti-notes">Notes</Label>
						<Textarea
							id="ti-notes"
							value={task.notes ?? ""}
							onChange={(e) => setNotes(e.target.value)}
							rows={4}
						/>
					</div>
				</div>

				<div className="space-y-4">
					<div>
						<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Computed schedule
							<span className="ml-1 normal-case text-muted-foreground/70">
								(days from project start)
							</span>
						</h3>
						{sched ? (
							<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
								<ScheduleStat
									label="Duration"
									tooltip="How long this task takes once it starts. Computed from your PERT estimate as (optimistic + 4·most likely + pessimistic) / 6."
									value={`${fmt(sched.duration)} d`}
								/>
								<ScheduleStat
									label="Slack"
									tooltip="Spare time before this task starts delaying the whole project. 0 days means it's on the critical path — any slip moves the finish date."
									value={`${fmt(sched.slack)} d`}
									highlight={sched.critical ? "critical" : undefined}
								/>
								<ScheduleStat
									label="Earliest start"
									tooltip="The earliest day this task can begin, given everything that has to finish first. (CPM: ES)"
									value={fmt(sched.earliestStart)}
									subValue={sched.earliestStartDate}
								/>
								<ScheduleStat
									label="Earliest finish"
									tooltip="Earliest start + duration. The earliest possible day this task could be done. (CPM: EF)"
									value={fmt(sched.earliestFinish)}
									subValue={sched.earliestFinishDate}
								/>
								<ScheduleStat
									label="Latest start"
									tooltip="The latest day this task can begin without delaying the project finish. (CPM: LS)"
									value={fmt(sched.latestStart)}
									subValue={sched.latestStartDate}
								/>
								<ScheduleStat
									label="Latest finish"
									tooltip="The latest day this task can end without delaying the project finish. (CPM: LF)"
									value={fmt(sched.latestFinish)}
									subValue={sched.latestFinishDate}
								/>
							</dl>
						) : (
							<p className="text-xs text-destructive">
								Cycle in the graph blocks scheduling.
							</p>
						)}
					</div>
					{mcTask && task.kind === "task" && <MonteCarloCard mc={mcTask} />}
				</div>
			</div>

			<Separator className="my-6" />
			<DependenciesSection
				task={task}
				doc={doc}
				changeDoc={changeDoc}
				projectId={projectId}
			/>
			<Separator className="my-6" />
			<DangerZone onDelete={onDelete} label="Delete task" />
		</div>
	);

	const trackView = (
		<div className="@container p-4">
			{conflictPill && <div className="mb-4">{conflictPill}</div>}
			<TaskSummary task={task} sched={sched} mcTask={mcTask} />
			{task.kind === "task" ? (
				<StatusRow
					status={status}
					progress={progressValue}
					onStatusChange={setStatus}
					onProgressChange={setProgress}
					actualStart={task.actualStart}
					actualFinish={task.actualFinish}
					onActualStartChange={setActualStart}
					onActualFinishChange={setActualFinish}
				/>
			) : (
				<div className="mt-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
					Milestones flip to done automatically when every predecessor is
					completed — there's nothing to mark here.
				</div>
			)}
		</div>
	);

	if (pane === "details") {
		return (
			<TaskOverview
				task={task}
				sched={sched}
				mcTask={mcTask}
				doc={doc}
				projectId={projectId}
				status={status}
				progress={progressValue}
				conflictPill={conflictPill}
			/>
		);
	}
	if (pane === "track") return trackView;
	return planView;
}

// Read-only consolidated view shown in the "All details" sub-tab. Mirrors
// every editable field on TaskForm as a labelled value, plus the computed
// schedule and dependency lists, so the user can survey the task in one
// glance without risking an accidental edit. Lists keep their navigate
// affordance — that's how the user gets across the graph.
function TaskOverview({
	task,
	sched,
	mcTask,
	doc,
	projectId,
	status,
	progress,
	conflictPill,
}: {
	task: Task;
	sched: TaskSchedule | null;
	mcTask: MonteCarloResult["tasks"][string] | null;
	doc: PertDoc;
	projectId: string;
	status: TaskStatus;
	progress: number;
	conflictPill?: React.ReactNode;
}) {
	const parent = task.parentId ? doc.tasksById[task.parentId] : null;
	const { incoming, outgoing } = useMemo(() => {
		const inc: Array<{ depId: string; otherId: TaskId }> = [];
		const out: Array<{ depId: string; otherId: TaskId }> = [];
		for (const dep of Object.values(doc.dependenciesById)) {
			if (dep.to.taskId === task.id && dep.from.taskId) {
				inc.push({ depId: dep.id, otherId: dep.from.taskId });
			} else if (dep.from.taskId === task.id && dep.to.taskId) {
				out.push({ depId: dep.id, otherId: dep.to.taskId });
			}
		}
		return { incoming: inc, outgoing: out };
	}, [doc, task.id]);
	const navigate = (id: TaskId) => {
		selectionStore.setState((s) => ({ ...s, projectId, taskId: id }));
	};
	return (
		<div className="@container space-y-5 p-4 text-sm">
			{conflictPill && <div>{conflictPill}</div>}
			<TaskSummary task={task} sched={sched} mcTask={mcTask} />

			<OverviewSection label="Description">
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
					<OverviewRow label="Title" value={task.title || "Untitled"} />
					<OverviewRow
						label="Kind"
						value={task.kind === "milestone" ? "Milestone" : "Task"}
					/>
					{task.key && (
						<OverviewRow
							label="Key"
							value={<span className="font-mono text-xs">{task.key}</span>}
						/>
					)}
					{parent && (
						<OverviewRow
							label="Inside"
							value={
								<button
									type="button"
									className="text-left hover:underline"
									onClick={() => navigate(parent.id)}
								>
									{parent.title || "Untitled container"}
								</button>
							}
						/>
					)}
				</dl>
				{task.notes && (
					<p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
						{task.notes}
					</p>
				)}
			</OverviewSection>

			{task.kind !== "milestone" && task.estimate && (
				<OverviewSection label="Estimate (PERT)">
					<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
						<OverviewRow
							label="Optimistic"
							value={`${fmt(task.estimate.optimistic)} ${task.estimate.unit}`}
						/>
						<OverviewRow
							label="Most likely"
							value={`${fmt(task.estimate.mostLikely)} ${task.estimate.unit}`}
						/>
						<OverviewRow
							label="Pessimistic"
							value={`${fmt(task.estimate.pessimistic)} ${task.estimate.unit}`}
						/>
					</dl>
				</OverviewSection>
			)}

			{task.kind === "task" && (
				<OverviewSection label="Progress">
					<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
						<OverviewRow
							label="Status"
							value={<StatusPill status={status} />}
						/>
						{status !== "not_started" && (
							<OverviewRow label="Done" value={`${progress}%`} />
						)}
						{task.actualStart && (
							<OverviewRow label="Started" value={task.actualStart} />
						)}
						{task.actualFinish && (
							<OverviewRow label="Finished" value={task.actualFinish} />
						)}
					</dl>
				</OverviewSection>
			)}

			{sched ? (
				<OverviewSection label="Computed schedule">
					<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
						<ScheduleStat
							label="Duration"
							tooltip="Beta-PERT expected duration (o + 4m + p)/6."
							value={`${fmt(sched.duration)} d`}
						/>
						<ScheduleStat
							label="Slack"
							tooltip="Days this task can slip before the project finish moves."
							value={`${fmt(sched.slack)} d`}
							highlight={sched.critical ? "critical" : undefined}
						/>
						<ScheduleStat
							label="Earliest start"
							tooltip="The earliest day this task can begin (CPM: ES)."
							value={fmt(sched.earliestStart)}
							subValue={sched.earliestStartDate}
						/>
						<ScheduleStat
							label="Earliest finish"
							tooltip="ES + duration (CPM: EF)."
							value={fmt(sched.earliestFinish)}
							subValue={sched.earliestFinishDate}
						/>
						<ScheduleStat
							label="Latest start"
							tooltip="Latest start without delaying the project (CPM: LS)."
							value={fmt(sched.latestStart)}
							subValue={sched.latestStartDate}
						/>
						<ScheduleStat
							label="Latest finish"
							tooltip="Latest finish without delaying the project (CPM: LF)."
							value={fmt(sched.latestFinish)}
							subValue={sched.latestFinishDate}
						/>
					</dl>
				</OverviewSection>
			) : (
				<p className="text-xs text-destructive">
					Cycle in the graph blocks scheduling.
				</p>
			)}

			{mcTask && task.kind === "task" && (
				<OverviewSection label="">
					<MonteCarloCard mc={mcTask} />
				</OverviewSection>
			)}

			<OverviewSection label="Dependencies">
				<OverviewDepList
					label="Depends on"
					rows={incoming}
					doc={doc}
					onNavigate={navigate}
					testId="overview-deps-incoming"
				/>
				<div className="mt-3">
					<OverviewDepList
						label="Required for"
						rows={outgoing}
						doc={doc}
						onNavigate={navigate}
						testId="overview-deps-outgoing"
					/>
				</div>
			</OverviewSection>
		</div>
	);
}

function OverviewSection({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			{label && (
				<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
					{label}
				</h3>
			)}
			{children}
		</section>
	);
}

function OverviewRow({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="min-w-0 text-xs">{value}</dd>
		</>
	);
}

function OverviewDepList({
	label,
	rows,
	doc,
	onNavigate,
	testId,
}: {
	label: string;
	rows: Array<{ depId: string; otherId: TaskId }>;
	doc: PertDoc;
	onNavigate: (id: TaskId) => void;
	testId: string;
}) {
	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-[11px] uppercase tracking-wide text-muted-foreground">
					{label}
				</span>
				<span className="text-[10px] text-muted-foreground">{rows.length}</span>
			</div>
			{rows.length === 0 ? (
				<p className="text-xs text-muted-foreground/70">—</p>
			) : (
				<ul className="space-y-1" data-testid={testId}>
					{rows.map((row) => {
						const other = doc.tasksById[row.otherId];
						return (
							<li
								key={row.depId}
								className="rounded-md border border-border/60 bg-card/40 px-2 py-1 text-xs"
							>
								<button
									type="button"
									onClick={() => onNavigate(row.otherId)}
									className="w-full truncate text-left hover:underline"
									title={other?.title ?? row.otherId}
								>
									{other?.title ?? row.otherId}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

// Compact at-a-glance card shown above the editor form. Three signals the
// user usually wants the moment they select a task: is it on the critical
// path, how long does it run, and where does it sit on the timeline.
function TaskSummary({
	task,
	sched,
	mcTask,
}: {
	task: Task;
	sched: TaskSchedule | null;
	mcTask: MonteCarloResult["tasks"][string] | null;
}) {
	if (!sched) {
		return (
			<div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
				{task.kind === "milestone"
					? "Milestone — fires at the latest finish of its predecessors."
					: "Schedule unavailable (graph has a cycle)."}
			</div>
		);
	}
	const onCritical = sched.critical;
	const status = sched.status;
	const span =
		task.kind === "milestone"
			? `day ${fmt(sched.earliestStart)}`
			: `${fmt(sched.earliestStart)}d → ${fmt(sched.earliestFinish)}d`;
	return (
		<div
			data-testid="inspector-summary"
			className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
		>
			<span
				className={
					onCritical
						? "inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 font-medium text-destructive"
						: "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400"
				}
			>
				{onCritical ? "On critical path" : `${fmt(sched.slack)}d slack`}
			</span>
			<StatusPill status={status} />
			{task.kind !== "milestone" && (
				<span className="text-muted-foreground">
					<span className="tabular-nums text-foreground">
						{fmt(sched.duration)}d
					</span>{" "}
					{status === "in_progress" ? "remaining" : "expected"}
				</span>
			)}
			<span className="text-muted-foreground">
				<span className="tabular-nums text-foreground">{span}</span>
			</span>
			{mcTask && task.kind === "task" && (
				<span
					className="text-muted-foreground"
					title="Monte Carlo P50 finish (days from project start)"
				>
					P50{" "}
					<span className="tabular-nums text-foreground">
						{fmt(mcTask.p50)}d
					</span>
				</span>
			)}
		</div>
	);
}

const STATUS_LABEL: Record<TaskStatus, string> = {
	not_started: "Not started",
	in_progress: "In progress",
	completed: "Completed",
};

function StatusPill({ status }: { status: TaskStatus }) {
	const cls =
		status === "completed"
			? "inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-700 dark:text-sky-300"
			: status === "in_progress"
				? "inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300"
				: "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground";
	return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

// Status + progress controls. Three buttons map onto not_started/in_progress/
// completed; the slider lets the user mark partial completion in 5% steps.
// Auto-flips: dragging the slider above 0 promotes a not_started task to
// in_progress; pinning at 100 marks it completed. Actual dates are recorded
// when the transitions happen.
function StatusRow({
	status,
	progress,
	onStatusChange,
	onProgressChange,
	actualStart,
	actualFinish,
	onActualStartChange,
	onActualFinishChange,
}: {
	status: TaskStatus;
	progress: number;
	onStatusChange: (s: TaskStatus) => void;
	onProgressChange: (v: number) => void;
	actualStart?: string;
	actualFinish?: string;
	// Optional — when omitted, the dates render as read-only labels (e.g.
	// in Storybook stages without a doc handle).
	onActualStartChange?: (next: string | undefined) => void;
	onActualFinishChange?: (next: string | undefined) => void;
}) {
	const isDone = status === "completed";
	const isStarted = status !== "not_started";
	return (
		<div
			data-testid="inspector-status"
			className="mt-3 rounded-md border bg-muted/20 p-3"
		>
			<div className="flex items-center justify-between gap-2">
				<div className="inline-flex rounded-md border bg-background p-0.5">
					<StatusButton
						active={!isStarted}
						onClick={() => onStatusChange("not_started")}
						icon={<CircleIcon className="size-3.5" />}
						label="Not started"
						testid="status-not-started"
					/>
					<StatusButton
						active={status === "in_progress"}
						onClick={() => onStatusChange("in_progress")}
						icon={<CircleDotIcon className="size-3.5" />}
						label="In progress"
						testid="status-in-progress"
					/>
					<StatusButton
						active={isDone}
						onClick={() => onStatusChange("completed")}
						icon={<CheckCircle2Icon className="size-3.5" />}
						label="Completed"
						testid="status-completed"
					/>
				</div>
				{isStarted && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 gap-1 text-xs"
						onClick={() => onStatusChange("not_started")}
						data-testid="status-reopen"
					>
						<RotateCcwIcon className="size-3" /> Reset
					</Button>
				)}
			</div>
			{(status === "in_progress" || status === "completed") && (
				<div className="mt-3 space-y-2">
					<div className="flex items-center justify-between text-xs">
						<Label className="text-xs text-muted-foreground">Progress</Label>
						<span className="tabular-nums">{progress}%</span>
					</div>
					<Slider
						data-testid="progress-slider"
						value={[progress]}
						min={0}
						max={100}
						step={5}
						disabled={isDone}
						onValueChange={(values) => {
							const v = values[0];
							if (typeof v === "number") onProgressChange(v);
						}}
					/>
					<Progress value={progress} className="h-1" />
				</div>
			)}
			{isStarted && (
				<div className="mt-3 grid grid-cols-2 gap-3 text-xs">
					<div className="space-y-1">
						<Label
							htmlFor="ti-actual-start"
							className="text-xs text-muted-foreground"
						>
							Started
						</Label>
						{onActualStartChange ? (
							<Input
								id="ti-actual-start"
								data-testid="actual-start-input"
								type="date"
								value={actualStart ?? ""}
								onChange={(e) =>
									onActualStartChange(e.target.value || undefined)
								}
								className="h-7 text-xs"
							/>
						) : (
							<span className="tabular-nums text-foreground">
								{actualStart ?? "—"}
							</span>
						)}
					</div>
					{(isDone || actualFinish) && (
						<div className="space-y-1">
							<Label
								htmlFor="ti-actual-finish"
								className="text-xs text-muted-foreground"
							>
								Finished
							</Label>
							{onActualFinishChange ? (
								<Input
									id="ti-actual-finish"
									data-testid="actual-finish-input"
									type="date"
									value={actualFinish ?? ""}
									onChange={(e) =>
										onActualFinishChange(e.target.value || undefined)
									}
									className="h-7 text-xs"
								/>
							) : (
								<span className="tabular-nums text-foreground">
									{actualFinish ?? "—"}
								</span>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function StatusButton({
	active,
	onClick,
	icon,
	label,
	testid,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
	testid: string;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={onClick}
			aria-pressed={active}
			className={
				active
					? "inline-flex items-center gap-1.5 rounded bg-foreground px-2 py-1 text-xs font-medium text-background"
					: "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
			}
		>
			{icon}
			{label}
		</button>
	);
}

function MonteCarloCard({ mc }: { mc: MonteCarloResult["tasks"][string] }) {
	const crit = Math.round(mc.criticality * 100);
	return (
		<div data-testid="inspector-monte-carlo">
			<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Monte Carlo finish
				<span className="ml-1 normal-case text-muted-foreground/70">
					(Beta-PERT, 1.5k trials)
				</span>
			</h3>
			<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
				<ScheduleStat
					label="P50"
					tooltip="The 'realistic' finish day: across 1,500 simulated runs, half finished by this day and half later. It's the coin-flip date — only 50/50 you'll actually hit it."
					value={`${fmt(mc.p50)} d`}
					subValue={mc.p50Date}
				/>
				<ScheduleStat
					label="P90"
					tooltip="The 'safe' finish day: 90% of simulated runs finished by this date. Use this when you commit to a stakeholder — only a 1-in-10 chance you slip past it."
					value={`${fmt(mc.p90)} d`}
					subValue={mc.p90Date}
				/>
				<ScheduleStat
					label="Criticality"
					tooltip="Percentage of simulated runs where this task ended up on the critical path. High values (≥80%) mean it drives the project finish in almost every plausible scenario — protect its estimate."
					value={`${crit}%`}
					highlight={crit >= 80 ? "critical" : undefined}
				/>
			</dl>
		</div>
	);
}

// Two-click confirm so a stray click in the inspector doesn't nuke a task.
// The button arms on first click and disarms after a short timeout if the
// user moves on without confirming.
function DangerZone({
	onDelete,
	label,
}: {
	onDelete: () => void;
	label: string;
}) {
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const id = window.setTimeout(() => setArmed(false), 3500);
		return () => window.clearTimeout(id);
	}, [armed]);
	return (
		<div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2">
			<div className="text-xs text-muted-foreground">
				{armed
					? "Are you sure? Click again within 3.5s."
					: "Permanently remove this task. Children, if any, are promoted to the parent."}
			</div>
			<Button
				type="button"
				size="sm"
				variant={armed ? "destructive" : "outline"}
				className="gap-1.5"
				onClick={() => {
					if (armed) {
						onDelete();
						setArmed(false);
					} else {
						setArmed(true);
					}
				}}
				data-testid="inspector-delete"
			>
				<Trash2Icon className="size-3.5" />
				{armed ? "Confirm" : label}
			</Button>
		</div>
	);
}

// Lists the dependencies touching the selected task (Depends on / Required
// for) and offers a small inline quick-add row to spawn a successor or
// predecessor in a single click. Each row is clickable to navigate to that
// task in the inspector.
function DependenciesSection({
	task,
	doc,
	changeDoc,
	projectId,
}: {
	task: Task;
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	projectId: string;
}) {
	const { incoming, outgoing } = useMemo(() => {
		const incoming: Array<{ depId: string; otherId: TaskId }> = [];
		const outgoing: Array<{ depId: string; otherId: TaskId }> = [];
		for (const dep of Object.values(doc.dependenciesById)) {
			if (dep.to.taskId === task.id && dep.from.taskId) {
				incoming.push({ depId: dep.id, otherId: dep.from.taskId });
			} else if (dep.from.taskId === task.id && dep.to.taskId) {
				outgoing.push({ depId: dep.id, otherId: dep.to.taskId });
			}
		}
		return { incoming, outgoing };
	}, [doc, task.id]);

	const removeDep = (depId: string) => {
		changeDoc((d) => {
			delete d.dependenciesById[depId];
		});
	};

	const navigate = (id: TaskId) => {
		selectionStore.setState((s) => ({ ...s, projectId, taskId: id }));
	};

	return (
		<div className="space-y-4">
			<DependencyList
				label="Depends on"
				hint="Tasks that must finish before this one can start."
				doc={doc}
				rows={incoming}
				onNavigate={navigate}
				onRemove={removeDep}
				testId="deps-incoming"
			/>
			<DependencyList
				label="Required for"
				hint="Tasks that wait on this one before they can start."
				doc={doc}
				rows={outgoing}
				onNavigate={navigate}
				onRemove={removeDep}
				testId="deps-outgoing"
			/>
			<QuickAddDependencyRow task={task} changeDoc={changeDoc} />
		</div>
	);
}

function DependencyList({
	label,
	hint,
	doc,
	rows,
	onNavigate,
	onRemove,
	testId,
}: {
	label: string;
	hint: string;
	doc: PertDoc;
	rows: Array<{ depId: string; otherId: TaskId }>;
	onNavigate: (id: TaskId) => void;
	onRemove: (depId: string) => void;
	testId: string;
}) {
	return (
		<div>
			<div className="mb-1.5 flex items-center justify-between">
				<h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
					{label}
				</h3>
				<span className="text-[10px] text-muted-foreground">{rows.length}</span>
			</div>
			{rows.length === 0 ? (
				<p
					className="text-xs text-muted-foreground"
					data-testid={`${testId}-empty`}
				>
					{hint}
				</p>
			) : (
				<ul className="space-y-1" data-testid={testId}>
					{rows.map((row) => {
						const other = doc.tasksById[row.otherId];
						return (
							<li
								key={row.depId}
								className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1 text-xs"
							>
								<button
									type="button"
									onClick={() => onNavigate(row.otherId)}
									className="min-w-0 flex-1 truncate text-left hover:underline"
									title={other?.title ?? row.otherId}
								>
									{other?.title ?? row.otherId}
								</button>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
									onClick={() => onRemove(row.depId)}
									data-testid={`${testId}-remove-${row.depId}`}
								>
									Remove
								</Button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

// Inline quick-add: the user types a name, optionally adjusts the estimate
// (most-likely days; o/p auto-derive as m/2 and m*2), and clicks Successor
// (current → new) or Predecessor (new → current). New tasks inherit the
// current task's parent so a quick-add inside a container stays inside it.
function QuickAddDependencyRow({
	task,
	changeDoc,
}: {
	task: Task;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
}) {
	const [title, setTitle] = useState("");
	const [estimateDays, setEstimateDays] = useState("");

	const submit = (direction: "successor" | "predecessor") => {
		const trimmed = title.trim();
		if (!trimmed) return;
		const m = Number.parseFloat(estimateDays);
		const mostLikely = Number.isFinite(m) && m > 0 ? m : 2;
		const optimistic = Math.max(0.25, mostLikely / 2);
		const pessimistic = mostLikely * 2;
		changeDoc((d) => {
			const { id: newId } = addTaskMutation(d, {
				title: trimmed,
				parentId: task.parentId,
				estimate: {
					optimistic,
					mostLikely,
					pessimistic,
					unit: "day",
				},
			});
			const fromId = direction === "successor" ? task.id : newId;
			const toId = direction === "successor" ? newId : task.id;
			addDependencyMutation(d, { fromTaskId: fromId, toTaskId: toId });
		});
		setTitle("");
		setEstimateDays("");
	};

	return (
		<div
			className="rounded-md border border-dashed border-border/70 bg-muted/20 p-2"
			data-testid="deps-quick-add"
		>
			<h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
				Add follow-up
			</h3>
			<div className="flex flex-col gap-1.5 @sm:flex-row">
				<Input
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="New task name"
					className="h-8 flex-1 text-xs"
					data-testid="deps-quick-add-title"
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submit("successor");
						}
					}}
				/>
				<Input
					value={estimateDays}
					onChange={(e) => setEstimateDays(e.target.value)}
					placeholder="est. days"
					inputMode="decimal"
					className="h-8 w-20 text-xs"
					data-testid="deps-quick-add-estimate"
				/>
			</div>
			<div className="mt-1.5 flex items-center gap-1">
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-7 flex-1 gap-1 text-[11px]"
					onClick={() => submit("predecessor")}
					disabled={!title.trim()}
					data-testid="deps-quick-add-predecessor"
					title="Insert a new task that this one depends on"
				>
					← Predecessor
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-7 flex-1 gap-1 text-[11px]"
					onClick={() => submit("successor")}
					disabled={!title.trim()}
					data-testid="deps-quick-add-successor"
					title="Insert a new task that depends on this one"
				>
					Successor →
				</Button>
			</div>
		</div>
	);
}

// Lists the direct children of a container with a "Remove from container"
// action that promotes the child one level up (to the container's parent).
function ChildrenSection({
	task,
	doc,
	changeDoc,
	projectId,
}: {
	task: Task;
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	projectId: string;
}) {
	const children = useMemo(() => getChildren(doc, task.id), [doc, task.id]);
	const navigate = (id: TaskId) => {
		selectionStore.setState((s) => ({ ...s, projectId, taskId: id }));
	};
	const detach = (childId: TaskId) => {
		changeDoc((d) => {
			moveTaskMutation(d, { taskId: childId, parentId: task.parentId ?? null });
		});
	};
	return (
		<div>
			<div className="mb-1.5 flex items-center justify-between">
				<h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
					Children
				</h3>
				<span className="text-[10px] text-muted-foreground">
					{children.length}
				</span>
			</div>
			{children.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					Drag a task onto this container on the canvas to nest it.
				</p>
			) : (
				<ul className="space-y-1" data-testid="container-children">
					{children.map((child) => (
						<li
							key={child.id}
							className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1 text-xs"
						>
							<button
								type="button"
								onClick={() => navigate(child.id)}
								className="min-w-0 flex-1 truncate text-left hover:underline"
								title={child.title}
							>
								<span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
									{child.kind === "container"
										? "box"
										: child.kind === "milestone"
											? "★"
											: ""}
								</span>
								{child.title || "Untitled"}
							</button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
								onClick={() => detach(child.id)}
								data-testid={`container-detach-${child.id}`}
							>
								Detach
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function EstimateField({
	label,
	id,
	value,
	onChange,
}: {
	label: string;
	id: string;
	value: number;
	onChange: (v: number) => void;
}) {
	return (
		<div className="space-y-1">
			<Label htmlFor={id} className="text-xs text-muted-foreground">
				{label}
			</Label>
			<Input
				id={id}
				data-testid={id}
				type="number"
				min={0}
				step="0.5"
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => {
					const parsed = Number.parseFloat(e.target.value);
					onChange(Number.isFinite(parsed) ? parsed : 0);
				}}
			/>
		</div>
	);
}

function ScheduleStat({
	label,
	tooltip,
	value,
	subValue,
	highlight,
}: {
	label: string;
	tooltip: string;
	value: string;
	subValue?: string;
	highlight?: "critical";
}) {
	return (
		<>
			<dt className="text-xs text-muted-foreground">
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={`What is ${label}?`}
							className="cursor-help bg-transparent decoration-dotted underline-offset-4 hover:underline"
						>
							{label}
						</button>
					</TooltipTrigger>
					<TooltipContent
						side="left"
						className="max-w-[260px] text-xs leading-snug"
					>
						{tooltip}
					</TooltipContent>
				</Tooltip>
			</dt>
			<dd
				className={
					highlight === "critical"
						? "font-semibold tabular-nums text-destructive"
						: "tabular-nums"
				}
			>
				{value}
				{subValue && (
					<span className="ml-1 text-xs text-muted-foreground">
						({subValue})
					</span>
				)}
			</dd>
		</>
	);
}

function fmt(n: number): string {
	const snapped = Math.abs(n) < 1e-6 ? 0 : n;
	if (Number.isInteger(snapped)) return snapped.toString();
	return snapped.toFixed(2);
}

function ContainerForm({
	task,
	doc,
	changeDoc,
	projectId,
	conflictPill,
	onDelete,
	mcResult,
	pane,
}: {
	task: Task;
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	projectId: string;
	conflictPill?: React.ReactNode;
	onDelete: () => void;
	mcResult: MonteCarloResult | null;
	pane: InspectorPane;
}) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const schedule = scheduleResult.ok ? scheduleResult.schedule : null;
	const rollup = useMemo(
		() => rollupContainer(doc, schedule, task.id),
		[doc, schedule, task.id],
	);
	const descendantIds = useMemo(
		() => getDescendants(doc, task.id),
		[doc, task.id],
	);
	const mcRollup = useMemo(() => {
		if (!mcResult) return null;
		const set = new Set(descendantIds);
		let p50 = 0;
		let p90 = 0;
		let maxCrit = 0;
		let count = 0;
		for (const [id, entry] of Object.entries(mcResult.tasks)) {
			if (!set.has(id)) continue;
			count += 1;
			if (entry.p50 > p50) p50 = entry.p50;
			if (entry.p90 > p90) p90 = entry.p90;
			if (entry.criticality > maxCrit) maxCrit = entry.criticality;
		}
		return count > 0 ? { p50, p90, maxCriticality: maxCrit } : null;
	}, [mcResult, descendantIds]);
	const pathRollups = useMemo(
		() => rollupContainerPaths(doc, schedule, mcResult, task.id),
		[doc, schedule, mcResult, task.id],
	);
	const mutateTask = useCallback(
		(mutate: (t: Task) => void) => {
			changeDoc((d) => {
				const draft = d.tasksById[task.id];
				if (draft) mutate(draft);
			});
		},
		[changeDoc, task.id],
	);

	const planView = (
		<div className="@container p-4">
			{conflictPill && <div className="mb-4">{conflictPill}</div>}
			<ContainerSummary rollup={rollup} />

			<div className="mt-4 grid grid-cols-1 gap-4 @4xl:grid-cols-2 @4xl:gap-6">
				<div className="space-y-5">
					<SectionHeading
						label="Hierarchy"
						hint="What this container holds and how to identify it."
					/>
					<div className="space-y-1.5">
						<Label htmlFor="ci-title">Title</Label>
						<Input
							id="ci-title"
							data-testid="inspector-title"
							value={task.title}
							onChange={(e) => {
								const next = e.target.value;
								mutateTask((d) => {
									d.title = next;
								});
							}}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="ci-key">
							Key{" "}
							<span className="text-muted-foreground/70">
								— dotted group, e.g. M1.A
							</span>
						</Label>
						<Input
							id="ci-key"
							data-testid="inspector-key"
							value={task.key ?? ""}
							onChange={(e) => {
								const next = e.target.value;
								mutateTask((d) => {
									const trimmed = next.trim();
									if (trimmed.length === 0) delete d.key;
									else d.key = trimmed;
								});
							}}
							placeholder="ungrouped"
							className="font-mono text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="ci-notes">Notes</Label>
						<Textarea
							id="ci-notes"
							value={task.notes ?? ""}
							onChange={(e) => {
								const next = e.target.value;
								mutateTask((d) => {
									d.notes = next;
								});
							}}
							rows={3}
						/>
					</div>
					<div className="pt-2">
						<ChildrenSection
							task={task}
							doc={doc}
							changeDoc={changeDoc}
							projectId={projectId}
						/>
					</div>
				</div>

				<div className="space-y-5">
					<SectionHeading
						label="Schedule"
						hint="Rolled-up scheduling stats across every descendant. When the container is collapsed, these are the numbers shown on the card."
					/>
					<div>
						<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Rollup
						</h3>
						<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
							<dt className="text-xs text-muted-foreground">Tasks</dt>
							<dd className="tabular-nums">{rollup.descendantCount}</dd>
							<dt className="text-xs text-muted-foreground">Expected</dt>
							<dd className="tabular-nums">{fmt(rollup.expected)} d</dd>
							<dt className="text-xs text-muted-foreground">Min slack</dt>
							<dd className="tabular-nums">
								{rollup.minSlack === null ? "—" : `${fmt(rollup.minSlack)} d`}
							</dd>
							<dt className="text-xs text-muted-foreground">Critical</dt>
							<dd
								className={
									rollup.hasCritical
										? "font-semibold tabular-nums text-destructive"
										: "tabular-nums"
								}
							>
								{rollup.criticalCount}
							</dd>
						</dl>
					</div>
					{mcRollup && (
						<div data-testid="container-monte-carlo">
							<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Monte Carlo (worst descendant)
							</h3>
							<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
								<ScheduleStat
									label="P50 finish"
									tooltip="The realistic finish day of the latest descendant: across 1,500 simulated runs, half of them had everything in this container done by this date."
									value={`${fmt(mcRollup.p50)} d`}
								/>
								<ScheduleStat
									label="P90 finish"
									tooltip="The safe finish day for the whole container: 90% of simulated runs finished every descendant by this date. Use it for stakeholder commitments."
									value={`${fmt(mcRollup.p90)} d`}
								/>
								<ScheduleStat
									label="Max criticality"
									tooltip="The highest criticality score across all descendants. Tells you how often at least one task inside this container ended up on the project's critical path."
									value={`${Math.round(mcRollup.maxCriticality * 100)}%`}
								/>
							</dl>
						</div>
					)}
					{pathRollups.length > 0 && (
						<div data-testid="container-path-rollups">
							<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Per-interface paths
							</h3>
							<table className="w-full text-xs">
								<thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
									<tr>
										<th className="py-1 text-left font-medium">Entry → Exit</th>
										<th className="py-1 text-right font-medium">Expected</th>
										{pathRollups.some((p) => p.p90 !== undefined) && (
											<th className="py-1 text-right font-medium">P90</th>
										)}
									</tr>
								</thead>
								<tbody>
									{pathRollups.map((p) => (
										<tr
											key={`${p.entryId}-${p.exitId}`}
											className="border-t"
											data-testid={`path-${p.entryId}-${p.exitId}`}
										>
											<td className="py-1">
												<span className="font-medium">{p.entryLabel}</span>
												<span className="mx-1 text-muted-foreground">→</span>
												<span className="font-medium">{p.exitLabel}</span>
											</td>
											<td className="py-1 text-right tabular-nums">
												{fmt(p.expected)}d
											</td>
											{p.p90 !== undefined && (
												<td className="py-1 text-right tabular-nums">
													{fmt(p.p90)}d
												</td>
											)}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>

			<Separator className="my-6" />
			<DangerZone onDelete={onDelete} label="Delete container" />
		</div>
	);

	const trackView = (
		<div className="@container p-4">
			{conflictPill && <div className="mb-4">{conflictPill}</div>}
			<ContainerSummary rollup={rollup} />
			<div className="mt-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
				A container's progress reflects its children. Open a child task to mark
				it started or finished.
			</div>
		</div>
	);

	if (pane === "details") {
		return (
			<ContainerOverview
				task={task}
				doc={doc}
				projectId={projectId}
				rollup={rollup}
				mcRollup={mcRollup}
				pathRollups={pathRollups}
				conflictPill={conflictPill}
			/>
		);
	}
	if (pane === "track") return trackView;
	return planView;
}

// Compact heading + tooltip used to label the three conceptual sections of
// the container inspector (Hierarchy / Boundary / Schedule). The hint comes
// from a hover tooltip so the headings stay scannable on narrow widths.
function SectionHeading({
	label,
	hint,
	trailing,
}: {
	label: string;
	hint: string;
	trailing?: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-2 border-b pb-1.5">
			<Tooltip>
				<TooltipTrigger asChild>
					<h3 className="cursor-help text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
						{label}
					</h3>
				</TooltipTrigger>
				<TooltipContent side="top" className="max-w-xs text-xs">
					{hint}
				</TooltipContent>
			</Tooltip>
			{trailing}
		</div>
	);
}

// Read-only consolidated view shown in the container's "All details" sub-tab.
// Mirrors the editable container form fields plus the schedule rollup, MC
// summary, per-interface paths, and a navigable children list.
function ContainerOverview({
	task,
	doc,
	projectId,
	rollup,
	mcRollup,
	pathRollups,
	conflictPill,
}: {
	task: Task;
	doc: PertDoc;
	projectId: string;
	rollup: ReturnType<typeof rollupContainer>;
	mcRollup: { p50: number; p90: number; maxCriticality: number } | null;
	pathRollups: ReturnType<typeof rollupContainerPaths>;
	conflictPill?: React.ReactNode;
}) {
	const parent = task.parentId ? doc.tasksById[task.parentId] : null;
	const children = useMemo(() => getChildren(doc, task.id), [doc, task.id]);
	const navigate = (id: TaskId) => {
		selectionStore.setState((s) => ({ ...s, projectId, taskId: id }));
	};
	return (
		<div className="@container space-y-5 p-4 text-sm">
			{conflictPill && <div>{conflictPill}</div>}
			<ContainerSummary rollup={rollup} />

			<OverviewSection label="Description">
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
					<OverviewRow label="Title" value={task.title || "Untitled"} />
					{task.key && (
						<OverviewRow
							label="Key"
							value={<span className="font-mono text-xs">{task.key}</span>}
						/>
					)}
					{parent && (
						<OverviewRow
							label="Inside"
							value={
								<button
									type="button"
									className="text-left hover:underline"
									onClick={() => navigate(parent.id)}
								>
									{parent.title || "Untitled container"}
								</button>
							}
						/>
					)}
				</dl>
				{task.notes && (
					<p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
						{task.notes}
					</p>
				)}
			</OverviewSection>

			<OverviewSection label="Children">
				{children.length === 0 ? (
					<p className="text-xs text-muted-foreground/70">
						Drag tasks onto this container on the canvas to nest them.
					</p>
				) : (
					<ul className="space-y-1" data-testid="overview-children">
						{children.map((child) => (
							<li
								key={child.id}
								className="rounded-md border border-border/60 bg-card/40 px-2 py-1 text-xs"
							>
								<button
									type="button"
									onClick={() => navigate(child.id)}
									className="w-full truncate text-left hover:underline"
									title={child.title}
								>
									<span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
										{child.kind === "container"
											? "box"
											: child.kind === "milestone"
												? "★"
												: ""}
									</span>
									{child.title || "Untitled"}
								</button>
							</li>
						))}
					</ul>
				)}
			</OverviewSection>

			<OverviewSection label="Schedule rollup">
				<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
					<dt className="text-xs text-muted-foreground">Tasks</dt>
					<dd className="tabular-nums text-xs">{rollup.descendantCount}</dd>
					<dt className="text-xs text-muted-foreground">Expected</dt>
					<dd className="tabular-nums text-xs">{fmt(rollup.expected)} d</dd>
					<dt className="text-xs text-muted-foreground">Min slack</dt>
					<dd className="tabular-nums text-xs">
						{rollup.minSlack === null ? "—" : `${fmt(rollup.minSlack)} d`}
					</dd>
					<dt className="text-xs text-muted-foreground">Critical</dt>
					<dd
						className={
							rollup.hasCritical
								? "font-semibold tabular-nums text-xs text-destructive"
								: "tabular-nums text-xs"
						}
					>
						{rollup.criticalCount}
					</dd>
				</dl>
			</OverviewSection>

			{mcRollup && (
				<OverviewSection label="Monte Carlo (worst descendant)">
					<dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
						<ScheduleStat
							label="P50 finish"
							tooltip="Realistic finish day of the latest descendant."
							value={`${fmt(mcRollup.p50)} d`}
						/>
						<ScheduleStat
							label="P90 finish"
							tooltip="Safe finish day for the whole container."
							value={`${fmt(mcRollup.p90)} d`}
						/>
						<ScheduleStat
							label="Max criticality"
							tooltip="Highest criticality score across all descendants."
							value={`${Math.round(mcRollup.maxCriticality * 100)}%`}
						/>
					</dl>
				</OverviewSection>
			)}

			{pathRollups.length > 0 && (
				<OverviewSection label="Per-interface paths">
					<table className="w-full text-xs">
						<thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
							<tr>
								<th className="py-1 text-left font-medium">Entry → Exit</th>
								<th className="py-1 text-right font-medium">Expected</th>
								{pathRollups.some((p) => p.p90 !== undefined) && (
									<th className="py-1 text-right font-medium">P90</th>
								)}
							</tr>
						</thead>
						<tbody>
							{pathRollups.map((p) => (
								<tr
									key={`${p.entryId}-${p.exitId}`}
									className="border-t"
									data-testid={`overview-path-${p.entryId}-${p.exitId}`}
								>
									<td className="py-1">
										<span className="font-medium">{p.entryLabel}</span>
										<span className="mx-1 text-muted-foreground">→</span>
										<span className="font-medium">{p.exitLabel}</span>
									</td>
									<td className="py-1 text-right tabular-nums">
										{fmt(p.expected)}d
									</td>
									{p.p90 !== undefined && (
										<td className="py-1 text-right tabular-nums">
											{fmt(p.p90)}d
										</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
				</OverviewSection>
			)}
		</div>
	);
}

// At-a-glance pills for containers — same shape as TaskSummary but reading
// from the rollup projection instead of the per-task schedule entry.
function ContainerSummary({
	rollup,
}: {
	rollup: ReturnType<typeof rollupContainer>;
}) {
	const onCritical = rollup.hasCritical;
	return (
		<div
			data-testid="inspector-summary"
			className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
		>
			<span
				className={
					onCritical
						? "inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 font-medium text-destructive"
						: "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400"
				}
			>
				{onCritical
					? `${rollup.criticalCount} on critical path`
					: rollup.minSlack === null
						? "No descendants"
						: `${fmt(rollup.minSlack)}d min slack`}
			</span>
			<span className="text-muted-foreground">
				<span className="tabular-nums text-foreground">
					{rollup.descendantCount}
				</span>{" "}
				task{rollup.descendantCount === 1 ? "" : "s"}
			</span>
			<span className="text-muted-foreground">
				<span className="tabular-nums text-foreground">
					{fmt(rollup.expected)}d
				</span>{" "}
				expected
			</span>
		</div>
	);
}

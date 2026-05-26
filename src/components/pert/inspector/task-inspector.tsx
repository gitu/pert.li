import { useStore } from "@tanstack/react-store";
import {
	CheckCircle2Icon,
	CircleDotIcon,
	CircleIcon,
	PlusIcon,
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
import { Textarea } from "#/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { removeTaskMutation } from "#/lib/ai/tool-mutators";
import { todayIsoDate } from "#/lib/pert/calendar";
import { getDescendants } from "#/lib/pert/hierarchy";
import type { MonteCarloResult } from "#/lib/pert/montecarlo";
import { rollupContainer, rollupContainerPaths } from "#/lib/pert/projection";
import { readTaskConflicts } from "#/lib/pert/read-conflicts";
import { computeSchedule, type TaskSchedule } from "#/lib/pert/schedule";
import { projectDocStore, selectionStore } from "#/lib/pert/store";
import type {
	ContainerInterface,
	Estimate,
	InterfaceId,
	InterfaceKind,
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

export function TaskInspector() {
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
	const body =
		task.kind === "container" ? (
			<ContainerForm
				key={task.id}
				task={task}
				doc={doc}
				changeDoc={safeChangeDoc}
				conflictPill={conflictPill}
				onDelete={onDelete}
				mcResult={mc.result}
			/>
		) : (
			<TaskForm
				key={task.id}
				task={task}
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
			/>
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
	scheduleResult,
	conflictPill,
	mcResult,
	onMutate,
	onDelete,
}: {
	task: Task;
	scheduleResult: ScheduleResult;
	conflictPill?: React.ReactNode;
	mcResult: MonteCarloResult | null;
	onMutate: (mutate: (draft: Task) => void) => void;
	onDelete: () => void;
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

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<header className="shrink-0 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Task
			</header>
			<div className="@container flex-1 overflow-auto p-4">
				{conflictPill && <div className="mb-4">{conflictPill}</div>}
				<TaskSummary task={task} sched={sched} mcTask={mcTask} />

				{task.kind === "task" && (
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
				)}

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
										onValueChange={(v) =>
											setEstimateUnit(v as Estimate["unit"])
										}
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
				<DangerZone onDelete={onDelete} label="Delete task" />
			</div>
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
	conflictPill,
	onDelete,
	mcResult,
}: {
	task: Task;
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	conflictPill?: React.ReactNode;
	onDelete: () => void;
	mcResult: MonteCarloResult | null;
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
	const leafDescendants = useMemo(
		() =>
			descendantIds
				.map((id) => doc.tasksById[id])
				.filter((t): t is Task => Boolean(t) && t.kind !== "container"),
		[descendantIds, doc.tasksById],
	);
	const interfaces = doc.interfacesByContainerId[task.id] ?? {};
	const interfaceList = useMemo(() => Object.values(interfaces), [interfaces]);

	const mutateTask = useCallback(
		(mutate: (t: Task) => void) => {
			changeDoc((d) => {
				const draft = d.tasksById[task.id];
				if (draft) mutate(draft);
			});
		},
		[changeDoc, task.id],
	);

	const addInterface = (kind: InterfaceKind) => {
		const id = newInterfaceId();
		changeDoc((d) => {
			if (!d.interfacesByContainerId[task.id]) {
				d.interfacesByContainerId[task.id] = {};
			}
			const ifs = d.interfacesByContainerId[task.id];
			ifs[id] = {
				id,
				containerId: task.id,
				kind,
				label: kind === "entry" ? "New entry" : "New exit",
			};
		});
	};

	const updateInterface = (
		interfaceId: InterfaceId,
		patch: (iface: ContainerInterface) => void,
	) => {
		changeDoc((d) => {
			const draft = d.interfacesByContainerId[task.id]?.[interfaceId];
			if (draft) patch(draft);
		});
	};

	const removeInterface = (interfaceId: InterfaceId) => {
		changeDoc((d) => {
			const ifs = d.interfacesByContainerId[task.id];
			if (ifs) delete ifs[interfaceId];
		});
	};

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<header className="shrink-0 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Container
			</header>
			<div className="@container flex-1 overflow-auto p-4">
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
							<SectionHeading
								label="Boundary"
								hint="Named ports on the container card. When the container is collapsed, cross-boundary edges route through whichever port a dependency pins (or the default port for that side)."
								trailing={
									<div className="flex items-center gap-1">
										<Button
											type="button"
											size="sm"
											variant="outline"
											className="h-7 gap-1 text-xs"
											onClick={() => addInterface("entry")}
											data-testid="container-add-entry"
										>
											<PlusIcon className="size-3" /> Entry
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											className="h-7 gap-1 text-xs"
											onClick={() => addInterface("exit")}
											data-testid="container-add-exit"
										>
											<PlusIcon className="size-3" /> Exit
										</Button>
									</div>
								}
							/>
							{interfaceList.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									No interfaces yet. Add entry/exit ports so collapsed edges
									have a labelled handle to attach to.
								</p>
							) : (
								<ul className="space-y-2">
									{interfaceList.map((iface) => (
										<InterfaceRow
											key={iface.id}
											iface={iface}
											leafChoices={leafDescendants}
											onChange={(patch) => updateInterface(iface.id, patch)}
											onRemove={() => removeInterface(iface.id)}
										/>
									))}
								</ul>
							)}
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
											<th className="py-1 text-left font-medium">
												Entry → Exit
											</th>
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
		</div>
	);
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

function InterfaceRow({
	iface,
	leafChoices,
	onChange,
	onRemove,
}: {
	iface: ContainerInterface;
	leafChoices: Task[];
	onChange: (patch: (iface: ContainerInterface) => void) => void;
	onRemove: () => void;
}) {
	return (
		<li
			data-testid={`interface-row-${iface.id}`}
			className="space-y-2 rounded-md border bg-card/40 p-2"
		>
			<div className="flex items-center gap-2">
				<Select
					value={iface.kind}
					onValueChange={(v) =>
						onChange((d) => {
							d.kind = v as InterfaceKind;
						})
					}
				>
					<SelectTrigger className="h-7 w-[88px] text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="entry">Entry</SelectItem>
						<SelectItem value="exit">Exit</SelectItem>
					</SelectContent>
				</Select>
				<Input
					value={iface.label}
					onChange={(e) => {
						const next = e.target.value;
						onChange((d) => {
							d.label = next;
						});
					}}
					className="h-7 flex-1 text-xs"
				/>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-7 text-destructive"
					aria-label="Remove interface"
					onClick={onRemove}
				>
					<Trash2Icon className="size-3.5" />
				</Button>
			</div>
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<span className="w-[88px]">Routes to</span>
				<Select
					value={iface.taskRef ?? UNSET_REF}
					onValueChange={(v) =>
						onChange((d) => {
							d.taskRef = v === UNSET_REF ? undefined : (v as TaskId);
						})
					}
				>
					<SelectTrigger className="h-7 flex-1 text-xs">
						<SelectValue placeholder="Select descendant" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={UNSET_REF}>— Not set —</SelectItem>
						{leafChoices.map((t) => (
							<SelectItem key={t.id} value={t.id}>
								{t.title || t.id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</li>
	);
}

const UNSET_REF = "__unset__";

function newInterfaceId(): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `if_${s}`;
}

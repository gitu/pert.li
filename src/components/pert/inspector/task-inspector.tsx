import { useStore } from "@tanstack/react-store";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ConflictPill } from "#/components/pert/inspector/conflict-pill";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import { Textarea } from "#/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { getDescendants } from "#/lib/pert/hierarchy";
import { rollupContainer } from "#/lib/pert/projection";
import { readTaskConflicts } from "#/lib/pert/read-conflicts";
import { computeSchedule } from "#/lib/pert/schedule";
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
} from "#/lib/pert/types";

// Right-pane editor for the currently selected task. Subscribes to two
// stores: which task is selected, and which project's doc is active. Reads
// the engine output too so callers see the live ES/EF/slack derived from
// their own edits — Automerge's local mutations are synchronous, so there's
// no latency hiding the round-trip.

export function TaskInspector() {
	const selection = useStore(selectionStore);
	const { doc, changeDoc, projectId } = useStore(projectDocStore);

	if (!doc || !changeDoc || !projectId) {
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
	const conflicts = readTaskConflicts(doc, task.id);
	const conflictPill = conflicts ? (
		<ConflictPill
			conflicts={conflicts}
			taskId={task.id}
			onResolve={changeDoc}
		/>
	) : null;
	if (task.kind === "container") {
		return (
			<ContainerForm
				key={task.id}
				task={task}
				doc={doc}
				changeDoc={changeDoc}
				conflictPill={conflictPill}
			/>
		);
	}
	return (
		<TaskForm
			key={task.id}
			task={task}
			scheduleResult={computeSchedule(doc)}
			conflictPill={conflictPill}
			onMutate={(mutate) =>
				changeDoc((d) => {
					const draft = d.tasksById[task.id];
					if (draft) mutate(draft);
				})
			}
		/>
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
	onMutate,
}: {
	task: Task;
	scheduleResult: ScheduleResult;
	conflictPill?: React.ReactNode;
	onMutate: (mutate: (draft: Task) => void) => void;
}) {
	const sched = scheduleResult.ok
		? scheduleResult.schedule.tasks[task.id]
		: null;

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

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<header className="shrink-0 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Task
			</header>
			<div className="flex-1 space-y-4 overflow-auto p-4">
				{conflictPill}
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

				<Separator />

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
							/>
							<ScheduleStat
								label="Earliest finish"
								tooltip="Earliest start + duration. The earliest possible day this task could be done. (CPM: EF)"
								value={fmt(sched.earliestFinish)}
							/>
							<ScheduleStat
								label="Latest start"
								tooltip="The latest day this task can begin without delaying the project finish. (CPM: LS)"
								value={fmt(sched.latestStart)}
							/>
							<ScheduleStat
								label="Latest finish"
								tooltip="The latest day this task can end without delaying the project finish. (CPM: LF)"
								value={fmt(sched.latestFinish)}
							/>
						</dl>
					) : (
						<p className="text-xs text-destructive">
							Cycle in the graph blocks scheduling.
						</p>
					)}
				</div>
			</div>
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
	highlight,
}: {
	label: string;
	tooltip: string;
	value: string;
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
}: {
	task: Task;
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	conflictPill?: React.ReactNode;
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
			<div className="flex-1 space-y-4 overflow-auto p-4">
				{conflictPill}
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

				<Separator />

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

				<Separator />

				<div>
					<div className="mb-2 flex items-center justify-between">
						<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Interfaces
						</h3>
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
					</div>
					{interfaceList.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No interfaces yet. Add entry/exit handles to give external edges
							specific routing targets when this container is collapsed.
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

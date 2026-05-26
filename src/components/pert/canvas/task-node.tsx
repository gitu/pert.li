import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
	AlertOctagonIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	PlusIcon,
	ZapIcon,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { PresenceBadge } from "#/components/pert/presence/presence-badge";
import { cn } from "#/lib/utils";
import { NodeDeleteButton } from "./node-delete-button";

export type TaskNodeData = {
	title: string;
	kind: "task" | "milestone";
	// Beta-PERT expected duration shown on the card label. Derived from the
	// schedule engine; not editable inline.
	durationDays: number;
	// Most-likely value from the user's estimate, used to seed the inline
	// edit form so the user sees and modifies the input they originally
	// typed rather than the calculated expected duration.
	mostLikelyDays?: number;
	slackDays: number | null;
	critical: boolean;
	hasEstimate: boolean;
	cycle?: boolean;
	status: "not_started" | "in_progress" | "completed";
	progress: number;
	// 0..1, only present when Monte Carlo has run. UI tints the border by it
	// so users see "this task is critical 80% of trials" without opening the
	// inspector.
	criticality?: number;
	// True for ~2.4s right after the task is added to the doc. Drives a
	// brief CSS pulse so the user notices the new node.
	justCreated?: boolean;
	// Called when the user confirms the on-node delete button. Two-click
	// confirm is handled inside NodeDeleteButton.
	onDelete?: () => void;
	// Inline-edit mode: when true the node replaces its title/duration
	// block with a small form so the user can rename + adjust the
	// most-likely estimate without opening the inspector. Wired up by the
	// canvas; the canvas's `onNodeDoubleClick` handler flips it on.
	editing?: boolean;
	onCommitEdit?: (next: { title: string; mostLikelyDays?: number }) => void;
	onCancelEdit?: () => void;
	// Radial quick-add: paired with the source/target handles on the right and
	// left edges. When the user hovers (or selects) a node, small "+" buttons
	// appear centred on each connector. Clicking spawns a new task and a
	// dependency wiring it to this node (predecessor on the left, successor on
	// the right). The canvas owns the actual mutation + selection follow-up.
	onAddPredecessor?: () => void;
	onAddSuccessor?: () => void;
};

// Custom React Flow node rendering a single task. Slack and critical state
// come from the Phase 3 CPM engine, not stored in the Automerge doc.
function TaskNodeImpl(props: NodeProps) {
	const data = props.data as unknown as TaskNodeData;
	const isMilestone = data.kind === "milestone";
	const isDone = data.status === "completed";
	const inFlight = data.status === "in_progress";
	const highCriticality =
		typeof data.criticality === "number" && data.criticality >= 0.5;

	return (
		<div
			data-testid={`task-node-${props.id}`}
			data-critical={data.critical}
			data-status={data.status}
			data-cycle={data.cycle ? "true" : undefined}
			data-just-created={data.justCreated || undefined}
			className={cn(
				"group relative min-h-[80px] w-[200px] rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm transition-colors",
				data.cycle
					? "border-destructive ring-2 ring-destructive/60 bg-destructive/5"
					: isDone
						? "border-sky-500/60 bg-sky-500/[0.04]"
						: data.critical || highCriticality
							? "border-destructive ring-1 ring-destructive/40"
							: inFlight
								? "border-amber-500/60"
								: "border-border",
				props.selected && "ring-2 ring-primary",
				data.justCreated && "pert-just-created",
			)}
		>
			<Handle
				type="target"
				position={Position.Left}
				className="!h-3 !w-3 !rounded-full !border-2 !border-background !bg-muted-foreground"
			/>
			{data.onAddPredecessor && (
				<QuickAddHandleButton
					side="left"
					onClick={data.onAddPredecessor}
					alwaysVisible={props.selected}
					testId={`task-add-predecessor-${props.id}`}
					label="Add predecessor task"
				/>
			)}
			{data.onAddSuccessor && (
				<QuickAddHandleButton
					side="right"
					onClick={data.onAddSuccessor}
					alwaysVisible={props.selected}
					testId={`task-add-successor-${props.id}`}
					label="Add dependent task"
				/>
			)}
			{data.onDelete && (
				<NodeDeleteButton
					onDelete={data.onDelete}
					alwaysVisible={props.selected}
					testId={`task-delete-${props.id}`}
				/>
			)}
			<div className="flex items-start gap-2">
				{data.cycle ? (
					<AlertOctagonIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				) : isMilestone ? (
					<CircleDotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				) : isDone ? (
					<CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
				) : inFlight ? (
					<CircleDotIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
				) : data.critical ? (
					<ZapIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				) : (
					<div className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" />
				)}
				<div className="min-w-0 flex-1">
					{data.editing && data.onCommitEdit && data.onCancelEdit ? (
						<InlineEditForm
							initialTitle={data.title}
							initialMostLikely={isMilestone ? undefined : data.mostLikelyDays}
							showEstimate={!isMilestone}
							onCommit={data.onCommitEdit}
							onCancel={data.onCancelEdit}
						/>
					) : (
						<>
							<div
								className={cn(
									"truncate text-sm",
									data.critical ? "font-semibold" : "font-medium",
								)}
							>
								{data.title || "Untitled"}
							</div>
							<div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
								{isMilestone ? (
									<span>milestone</span>
								) : (
									<>
										<span>
											{data.hasEstimate ? fmt(data.durationDays) : "?"} d
										</span>
										{!data.cycle &&
											data.slackDays !== null &&
											!data.critical && (
												<>
													<span aria-hidden>·</span>
													<span>{fmt(data.slackDays)}d slack</span>
												</>
											)}
										{!data.cycle && data.critical && (
											<>
												<span aria-hidden>·</span>
												<span className="font-semibold text-destructive">
													critical
												</span>
											</>
										)}
										{data.cycle && (
											<>
												<span aria-hidden>·</span>
												<span className="font-semibold text-destructive">
													on cycle
												</span>
											</>
										)}
									</>
								)}
							</div>
						</>
					)}
				</div>
			</div>
			{(inFlight || isDone) && (
				<div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
					<div
						data-testid={`task-progress-${props.id}`}
						className={cn(
							"h-full transition-all",
							isDone ? "bg-sky-500" : "bg-amber-500",
						)}
						style={{ width: `${Math.max(0, Math.min(100, data.progress))}%` }}
					/>
				</div>
			)}
			<PresenceBadge taskId={props.id} className="absolute -top-2 -right-2" />
			<Handle
				type="source"
				position={Position.Right}
				className="!h-3 !w-3 !rounded-full !border-2 !border-background !bg-muted-foreground"
			/>
		</div>
	);
}

function fmt(n: number): string {
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

// Radial "+" affordance pinned to the source/target connector on a leaf
// node. Stays hidden until the parent card is hovered or selected, so the
// canvas stays quiet at rest. Pushed half its width outside the card so it
// sits centred on the existing handle dot rather than overlapping the
// title; `nodrag` + stopPropagation keep React Flow from reading the click
// as a node drag.
function QuickAddHandleButton({
	side,
	onClick,
	alwaysVisible,
	testId,
	label,
}: {
	side: "left" | "right";
	onClick: () => void;
	alwaysVisible?: boolean;
	testId: string;
	label: string;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			aria-label={label}
			title={label}
			className={cn(
				"nodrag absolute top-1/2 z-20 grid size-6 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm transition-opacity hover:border-primary hover:text-primary",
				side === "left" ? "-left-7" : "-right-7",
				alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
			)}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
		>
			<PlusIcon className="size-3.5" />
		</button>
	);
}

// Two-field inline editor rendered in place of the title/duration block when
// the user double-clicks a node. Title autofocuses; Enter commits, Escape
// cancels, blur outside the form commits. Class `nodrag` so React Flow
// doesn't grab the inputs as a node drag, and `nopan`/`nowheel` so cursor
// keys + scroll behave like a normal text input.
function InlineEditForm({
	initialTitle,
	initialMostLikely,
	showEstimate,
	onCommit,
	onCancel,
}: {
	initialTitle: string;
	initialMostLikely: number | undefined;
	showEstimate: boolean;
	onCommit: (next: { title: string; mostLikelyDays?: number }) => void;
	onCancel: () => void;
}) {
	const [title, setTitle] = useState(initialTitle);
	const [estDays, setEstDays] = useState(
		initialMostLikely === undefined ? "" : String(initialMostLikely),
	);
	const titleRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		titleRef.current?.focus();
		titleRef.current?.select();
	}, []);

	const commit = () => {
		const trimmed = title.trim();
		if (!trimmed) {
			onCancel();
			return;
		}
		const parsed = Number.parseFloat(estDays);
		onCommit({
			title: trimmed,
			mostLikelyDays:
				showEstimate && Number.isFinite(parsed) && parsed > 0
					? parsed
					: undefined,
		});
	};

	return (
		<form
			className="nodrag nopan space-y-1"
			onSubmit={(e) => {
				e.preventDefault();
				commit();
			}}
			onBlur={(e) => {
				// Commit when focus leaves the entire form (not when moving
				// between the two inputs inside it).
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
					commit();
				}
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
		>
			<input
				ref={titleRef}
				data-testid="task-inline-title"
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="Title"
				className="nowheel w-full rounded border border-border bg-background px-1.5 py-0.5 text-sm font-medium focus:border-primary focus:outline-none"
			/>
			{showEstimate && (
				<div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
					<input
						data-testid="task-inline-estimate"
						value={estDays}
						onChange={(e) => setEstDays(e.target.value)}
						placeholder="est."
						inputMode="decimal"
						className="nowheel w-12 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none"
					/>
					<span>d (most likely)</span>
				</div>
			)}
		</form>
	);
}

export const TaskNode = memo(TaskNodeImpl);

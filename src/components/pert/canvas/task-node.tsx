import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
	AlertOctagonIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	ExternalLinkIcon,
	FlagIcon,
	PlusIcon,
	ZapIcon,
} from "lucide-react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { PresenceBadge } from "#/components/pert/presence/presence-badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import type { CanvasLayoutMode } from "#/lib/pert/types";
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
	// External issue references (Jira keys / URLs). Surfaced as a small badge on
	// the node; the click-through links live in the inspector + table (a node
	// link would fight canvas selection/drag).
	issueKeys?: string[];
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
	// left edges. When the user hovers (or selects) a node, a stack of buttons
	// — one for a follow-up task, one for a milestone — appears centred on each
	// connector. Clicking spawns the new node + dependency wiring it to this
	// task (predecessor on the left, successor on the right). The canvas owns
	// the mutation + selection follow-up; the same actions are bound to
	// ⌘← / ⌘→ at the canvas level.
	onAddPredecessor?: (kind: "task" | "milestone") => void;
	onAddSuccessor?: (kind: "task" | "milestone") => void;
	// DISPLAY-SETTINGS: per-project node display config, threaded from the doc
	// via pushLeafNode (resolveDisplaySettings().canvas). Field flags are read
	// default-truthy (`!== false`) so nodes built without them (older stories /
	// tests) keep showing everything. `layout` only changes internal density —
	// the node's reported height stays TASK_HEIGHT (canvas layout math depends
	// on it).
	showDuration?: boolean;
	showSlack?: boolean;
	showProgress?: boolean;
	// POST-ISSUE-LINKS: toggles the issue-keys badge (issue-links feature). Read
	// default-truthy like the other field flags so nodes built without it (older
	// stories / tests) keep showing the badge.
	showIssueKeys?: boolean;
	// PARALLEL-STAFFING: an ADDITIONAL hint (never the duration). `showStaffing`
	// is the display toggle (default OFF — read `=== true`). `staffingPeople` /
	// `staffingDays` are only set when ≥2 equal people could crash this task;
	// when unset the badge renders nothing.
	showStaffing?: boolean;
	staffingPeople?: number;
	staffingDays?: number;
	layout?: CanvasLayoutMode;
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
	// DISPLAY-SETTINGS: density + per-field visibility (default-truthy).
	const compact = data.layout === "compact";
	const showDuration = data.showDuration !== false;
	const showSlack = data.showSlack !== false;
	const showProgress = data.showProgress !== false;
	const showIssueKeys = data.showIssueKeys !== false;
	// PARALLEL-STAFFING badge defaults OFF (opt-in field), so read strict-true.
	const showStaffing =
		data.showStaffing === true &&
		typeof data.staffingPeople === "number" &&
		data.staffingPeople > 1;
	// Build the secondary meta line as discrete segments so toggling a field off
	// never leaves a dangling "·" separator. A cycle is an error state — always
	// shown, regardless of the slack toggle.
	const metaSegments: ReactNode[] = [];
	if (!isMilestone) {
		if (showDuration) {
			metaSegments.push(
				<span key="dur">
					{data.hasEstimate ? fmt(data.durationDays) : "?"} d
				</span>,
			);
		}
		if (showSlack && !data.cycle && data.slackDays !== null && !data.critical) {
			metaSegments.push(<span key="slack">{fmt(data.slackDays)}d slack</span>);
		}
		if (showSlack && !data.cycle && data.critical) {
			metaSegments.push(
				<span key="crit" className="font-semibold text-destructive">
					critical
				</span>,
			);
		}
		if (data.cycle) {
			metaSegments.push(
				<span key="cycle" className="font-semibold text-destructive">
					on cycle
				</span>,
			);
		}
		if (showStaffing) {
			metaSegments.push(
				<span
					key="staffing"
					className="text-sky-600 dark:text-sky-400"
					title={`Parallel staffing: up to ${data.staffingPeople} people → ~${fmt(
						data.staffingDays ?? 0,
					)} d wall-clock. An extra forecast, not the task duration.`}
				>
					⚡{data.staffingPeople}→{fmt(data.staffingDays ?? 0)}d
				</span>,
			);
		}
	}
	// The meta line only renders when there's something in it (milestone label,
	// or at least one visible task segment) — a toggled-off line leaves no gap.
	const showMeta = isMilestone || metaSegments.length > 0;

	return (
		<div
			data-testid={`task-node-${props.id}`}
			data-critical={data.critical}
			data-status={data.status}
			data-cycle={data.cycle ? "true" : undefined}
			data-just-created={data.justCreated || undefined}
			data-layout={compact ? "compact" : "detailed"}
			className={cn(
				"group relative w-[200px] rounded-lg border bg-card text-card-foreground shadow-sm transition-colors",
				compact ? "min-h-[56px] px-3 py-1.5" : "min-h-[80px] px-3 py-2",
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
				title="Drag here to link a predecessor"
				className="!h-3 !w-3 !cursor-crosshair !rounded-full !border-2 !border-background !bg-muted-foreground !transition-all hover:!h-4 hover:!w-4 hover:!bg-primary"
			/>
			{data.onAddPredecessor && (
				<QuickAddCluster
					side="left"
					onAdd={data.onAddPredecessor}
					alwaysVisible={props.selected}
					nodeId={props.id}
				/>
			)}
			{data.onAddSuccessor && (
				<QuickAddCluster
					side="right"
					onAdd={data.onAddSuccessor}
					alwaysVisible={props.selected}
					nodeId={props.id}
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
									// Truncated normally; on hover the full title expands (the
									// card grows past its min-height and overlays whatever sits
									// below — a hovered node is z-elevated in styles.css).
									"truncate text-sm group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words",
									data.critical ? "font-semibold" : "font-medium",
								)}
								data-testid={`task-title-${props.id}`}
							>
								{data.title || "Untitled"}
							</div>
							{showMeta && (
								<div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
									{isMilestone ? (
										<span>milestone</span>
									) : (
										metaSegments.map((seg, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: segments are a fixed, ordered list; the separator's position is its identity
											<span key={`seg-${i}`} className="contents">
												{i > 0 && <span aria-hidden>·</span>}
												{seg}
											</span>
										))
									)}
								</div>
							)}
						</>
					)}
				</div>
			</div>
			{showProgress && (inFlight || isDone) && (
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
			{showIssueKeys && data.issueKeys && data.issueKeys.length > 0 && (
				<Tooltip>
					<TooltipTrigger asChild>
						<span
							data-testid={`task-issues-${props.id}`}
							className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground"
						>
							<ExternalLinkIcon className="size-3 shrink-0" />
							{data.issueKeys.length === 1
								? data.issueKeys[0]
								: `${data.issueKeys.length} issues`}
						</span>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{data.issueKeys.join(", ")}
					</TooltipContent>
				</Tooltip>
			)}
			<PresenceBadge taskId={props.id} className="absolute -top-2 -right-2" />
			<Handle
				type="source"
				position={Position.Right}
				title="Drag from here to link a successor"
				className="!h-3 !w-3 !cursor-crosshair !rounded-full !border-2 !border-background !bg-muted-foreground !transition-all hover:!h-4 hover:!w-4 hover:!bg-primary"
			/>
		</div>
	);
}

function fmt(n: number): string {
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

// Radial quick-add cluster: a vertical pair of buttons (task + milestone)
// flanking a source/target connector. Stays hidden until the parent card is
// hovered or selected so the canvas reads quiet at rest. Pushed further
// outside the card than a single-button would be so the two buttons clear
// the connector dot symmetrically and tooltips don't crowd the node label.
function QuickAddCluster({
	side,
	alwaysVisible,
	onAdd,
	nodeId,
}: {
	side: "left" | "right";
	alwaysVisible?: boolean;
	onAdd: (kind: "task" | "milestone") => void;
	nodeId: string;
}) {
	const isLeft = side === "left";
	const directionWord = isLeft ? "predecessor" : "successor";
	const shortcut = isLeft ? "⌘←" : "⌘→";
	return (
		<div
			className={cn(
				"absolute top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 transition-opacity",
				isLeft ? "-left-12" : "-right-12",
				alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
			)}
		>
			<QuickAddButton
				side={side}
				kind="task"
				onClick={() => onAdd("task")}
				testId={`task-add-${directionWord}-task-${nodeId}`}
				label={
					isLeft
						? `Add predecessor task (${shortcut})`
						: `Add dependent task (${shortcut})`
				}
			/>
			<QuickAddButton
				side={side}
				kind="milestone"
				onClick={() => onAdd("milestone")}
				testId={`task-add-${directionWord}-milestone-${nodeId}`}
				label={isLeft ? "Add predecessor milestone" : "Add dependent milestone"}
			/>
		</div>
	);
}

function QuickAddButton({
	side,
	kind,
	onClick,
	testId,
	label,
}: {
	side: "left" | "right";
	kind: "task" | "milestone";
	onClick: () => void;
	testId: string;
	label: string;
}) {
	const Icon = kind === "milestone" ? FlagIcon : PlusIcon;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					data-testid={testId}
					aria-label={label}
					className={cn(
						"nodrag grid size-6 place-items-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm hover:border-primary hover:text-primary",
					)}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => {
						e.stopPropagation();
						onClick();
					}}
				>
					<Icon className="size-3.5" />
				</button>
			</TooltipTrigger>
			<TooltipContent side={side === "left" ? "left" : "right"}>
				{label}
			</TooltipContent>
		</Tooltip>
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

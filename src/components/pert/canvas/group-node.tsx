import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FolderIcon,
	ZapIcon,
} from "lucide-react";
import { memo } from "react";
import type { GroupRollup } from "#/lib/pert/projection";
import { cn } from "#/lib/utils";
import { NodeDeleteButton } from "./node-delete-button";

// Two related node renderings for a group:
//  - "group-collapsed" — a single card showing the group's WBS number + name
//    and its rolled-up schedule stats. A single default target handle (left)
//    and source handle (right) let cross-boundary edges attach when members
//    are hidden inside it.
//  - "group-expanded" — a translucent labelled panel that sits behind its
//    member tasks so they read as a group. Members are ordinary React Flow
//    nodes; the panel is just a visual wrapper.

export type GroupNodeData = {
	name: string;
	// Derived WBS number ("1", "1.2"); "" when the group has no number.
	number: string;
	rollup: GroupRollup | null;
	collapsed: boolean;
	onToggle: () => void;
	// True while the user is dragging a task over this group. Renders a
	// drop-target ring + glow.
	dropTarget?: boolean;
	// True for ~2.4s right after the group is added. Drives a brief CSS pulse.
	justCreated?: boolean;
	// Fires when the user finishes a resize drag. The canvas persists the size
	// to Group.layout.width/height; later renders honour it as a minimum.
	onResizeEnd?: (size: { width: number; height: number }) => void;
	minWidth?: number;
	minHeight?: number;
	// Called when the user confirms the on-node delete button (two-click
	// confirm handled inside NodeDeleteButton). Deleting promotes members.
	onDelete?: () => void;
};

// Match the task / milestone card width so a collapsed group reads as a peer
// of its siblings on the canvas, not an oversized chrome element.
export const COLLAPSED_CARD_WIDTH = 220;

// Fixed height for the collapsed card — header + meta + progress. No port rail
// any more, so it's a constant.
export function groupCollapsedHeight(_data: GroupNodeData): number {
	return 96;
}

function label(number: string, name: string, fallback: string): string {
	const display = name || fallback;
	return number ? `${number} ${display}` : display;
}

function CollapsedImpl(props: NodeProps) {
	const data = props.data as unknown as GroupNodeData;
	const rollup = data.rollup;
	const critical = rollup?.hasCritical ?? false;
	const allDone =
		(rollup?.descendantCount ?? 0) > 0 &&
		rollup?.completedCount === rollup?.descendantCount;
	const inFlight =
		(rollup?.inProgressCount ?? 0) > 0 ||
		((rollup?.completedCount ?? 0) > 0 && !allDone);
	const progress = Math.round(rollup?.progress ?? 0);
	const minHeight = groupCollapsedHeight(data);
	return (
		<div
			data-testid={`group-collapsed-${props.id}`}
			data-critical={critical}
			style={{ minHeight, width: "100%" }}
			data-just-created={data.justCreated || undefined}
			className={cn(
				"group relative rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm transition-shadow",
				allDone
					? "border-sky-500/60 bg-sky-500/[0.04]"
					: critical
						? "border-destructive ring-1 ring-destructive/40"
						: inFlight
							? "border-amber-500/60"
							: "border-border",
				props.selected && "ring-2 ring-primary",
				data.dropTarget &&
					"ring-2 ring-primary shadow-[0_0_0_3px_var(--primary)/30] !border-primary",
				data.justCreated && "pert-just-created",
			)}
		>
			<NodeResizer
				minWidth={data.minWidth ?? COLLAPSED_CARD_WIDTH}
				minHeight={data.minHeight ?? minHeight}
				isVisible={props.selected}
				onResizeEnd={(_, p) =>
					data.onResizeEnd?.({ width: p.width, height: p.height })
				}
				lineClassName="!border-primary/30"
				handleClassName="!bg-primary !border-background"
			/>
			{data.onDelete && (
				<NodeDeleteButton
					onDelete={data.onDelete}
					alwaysVisible={props.selected}
					testId={`group-delete-${props.id}`}
				/>
			)}
			{/* Single default in/out handles so rerouted collapsed edges attach. */}
			<Handle
				type="target"
				position={Position.Left}
				className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground"
			/>
			<Handle
				type="source"
				position={Position.Right}
				className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground"
			/>
			{/* Expand affordance: single click expands. */}
			<button
				type="button"
				aria-label="Expand group"
				data-testid={`group-toggle-${props.id}`}
				className={cn(
					"nodrag absolute top-1 left-1 z-20 grid size-6 place-items-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm transition-opacity hover:text-foreground",
					props.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
				)}
				title="Expand"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={(e) => {
					e.stopPropagation();
					data.onToggle();
				}}
			>
				<ChevronRightIcon className="size-3.5" />
			</button>
			<div className="flex items-start gap-2">
				<FolderIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
						{label(data.number, data.name, "Group")}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
						<span>{rollup?.descendantCount ?? 0} tasks</span>
						{rollup && rollup.scheduledCount > 0 && (
							<>
								<span aria-hidden>·</span>
								<span>{fmt(rollup.expected)} d total</span>
							</>
						)}
						{critical && (
							<>
								<span aria-hidden>·</span>
								<span className="flex items-center gap-0.5 font-semibold text-destructive">
									<ZapIcon className="size-3" />
									{rollup?.criticalCount} critical
								</span>
							</>
						)}
						{rollup?.minSlack !== null && rollup?.minSlack !== undefined && (
							<>
								<span aria-hidden>·</span>
								<span>min slack {fmt(rollup.minSlack)}d</span>
							</>
						)}
						{rollup &&
							(rollup.completedCount > 0 || rollup.inProgressCount > 0) && (
								<>
									<span aria-hidden>·</span>
									<span>
										{rollup.completedCount}/{rollup.descendantCount} done
									</span>
								</>
							)}
					</div>
				</div>
			</div>
			{(inFlight || allDone) && (
				<div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
					<div
						data-testid={`group-progress-${props.id}`}
						className={cn(
							"h-full transition-all",
							allDone ? "bg-sky-500" : "bg-amber-500",
						)}
						style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
					/>
				</div>
			)}
		</div>
	);
}

function ExpandedImpl(props: NodeProps) {
	const data = props.data as unknown as GroupNodeData;
	const width = props.width ?? 320;
	const height = props.height ?? 200;
	return (
		<div
			data-testid={`group-expanded-${props.id}`}
			data-just-created={data.justCreated || undefined}
			className={cn(
				"group rounded-lg border-2 border-dashed border-foreground/25 bg-foreground/[0.04] shadow-sm transition-colors dark:bg-foreground/[0.02]",
				props.selected && "ring-2 ring-primary",
				data.dropTarget &&
					"ring-2 ring-primary !border-primary !border-solid bg-primary/[0.06]",
				data.justCreated && "pert-just-created",
			)}
			style={{ width: "100%", height: "100%" }}
		>
			<NodeResizer
				minWidth={data.minWidth ?? width}
				minHeight={data.minHeight ?? height}
				isVisible={props.selected}
				onResizeEnd={(_, p) =>
					data.onResizeEnd?.({ width: p.width, height: p.height })
				}
				lineClassName="!border-primary/30"
				handleClassName="!bg-primary !border-background"
			/>
			{data.onDelete && (
				<NodeDeleteButton
					onDelete={data.onDelete}
					alwaysVisible={props.selected}
					testId={`group-delete-${props.id}`}
				/>
			)}
			<div
				data-drag-handle="group-header"
				className="flex cursor-move items-center gap-1.5 border-b border-dashed bg-card/80 px-2 py-1 text-xs font-medium backdrop-blur-sm"
			>
				<button
					type="button"
					aria-label="Collapse group"
					data-testid={`group-toggle-${props.id}`}
					className="nodrag grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent"
					onClick={(e) => {
						e.stopPropagation();
						data.onToggle();
					}}
				>
					<ChevronDownIcon className="size-3.5" />
				</button>
				<FolderIcon className="size-3.5 text-muted-foreground" />
				<span className="truncate group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
					{label(data.number, data.name, "Group")}
				</span>
			</div>
		</div>
	);
}

export const GroupCollapsedNode = memo(CollapsedImpl);
export const GroupExpandedNode = memo(ExpandedImpl);

function fmt(n: number): string {
	const snapped = Math.abs(n) < 1e-6 ? 0 : n;
	if (Number.isInteger(snapped)) return snapped.toString();
	return snapped.toFixed(2);
}

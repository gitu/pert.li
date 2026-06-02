import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FolderIcon,
	ZapIcon,
} from "lucide-react";
import { memo } from "react";
import type { ContainerRollup } from "#/lib/pert/projection";
import { cn } from "#/lib/utils";
import { NodeDeleteButton } from "./node-delete-button";

// Two related node renderings for a container task:
//  - "container-collapsed" — single card with a port rail down each side
//    (entries on the left, exits on the right). Cross-boundary edges attach
//    to specific ports by id so the user can see *which* interface a
//    collapsed edge is using.
//  - "container-expanded" — translucent labelled panel that sits behind its
//    descendants on the canvas so they read as a group. Descendants are
//    still ordinary React Flow nodes; the panel is just a visual wrapper.

export type ContainerPort = { id: string; label: string };

export type ContainerNodeData = {
	title: string;
	rollup: ContainerRollup | null;
	collapsed: boolean;
	onToggle: () => void;
	// Sorted by interface id so the rendered order is stable across renders.
	// Empty array means the container has no interfaces of that side yet —
	// the node still renders one unlabeled handle so edges can attach.
	entries: ContainerPort[];
	exits: ContainerPort[];
	// True while the user is dragging a leaf over this container. Renders
	// a drop-target ring + glow.
	dropTarget?: boolean;
	// True for ~2.4s right after the task is added to the doc. Drives a
	// brief CSS pulse so the user notices the new node.
	justCreated?: boolean;
	// Fires when the user finishes a resize drag. The canvas persists the
	// stored size to Task.layout.width/height; subsequent renders honour it
	// as a minimum (descendants can still grow the box larger).
	onResizeEnd?: (size: { width: number; height: number }) => void;
	// Minimum size the resizer should enforce. Defaults are computed by the
	// canvas based on the auto-fit bounds + port rail.
	minWidth?: number;
	minHeight?: number;
	// Called when the user confirms the on-node delete button. Two-click
	// confirm is handled inside NodeDeleteButton.
	onDelete?: () => void;
};

const PORT_GAP = 26;
const PORT_HEADER_OFFSET = 40;
// Match the task / milestone card width so a collapsed container reads as
// a peer of its siblings on the canvas, not an oversized chrome element.
export const COLLAPSED_CARD_WIDTH = 200;

// Height needed to fit the larger port rail of the two sides. Used by the
// canvas builder so React Flow allocates enough space, and again here for the
// inline style on the card container.
export function containerCollapsedHeight(data: ContainerNodeData): number {
	const sides = Math.max(data.entries.length || 1, data.exits.length || 1);
	const base = 96; // header + meta + progress
	const extra = Math.max(0, sides - 1) * PORT_GAP;
	return base + extra;
}

function CollapsedImpl(props: NodeProps) {
	const data = props.data as unknown as ContainerNodeData;
	const rollup = data.rollup;
	const critical = rollup?.hasCritical ?? false;
	const allDone =
		(rollup?.descendantCount ?? 0) > 0 &&
		rollup?.completedCount === rollup?.descendantCount;
	const inFlight =
		(rollup?.inProgressCount ?? 0) > 0 ||
		((rollup?.completedCount ?? 0) > 0 && !allDone);
	const progress = Math.round(rollup?.progress ?? 0);
	const minHeight = containerCollapsedHeight(data);
	return (
		<div
			data-testid={`container-collapsed-${props.id}`}
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
					testId={`container-delete-${props.id}`}
				/>
			)}
			<InterfaceRail ports={data.entries} side="left" />
			<InterfaceRail ports={data.exits} side="right" />
			{/* Expand affordance mirrors NodeDeleteButton: absolute top-left,
			    hidden until hover (or always visible when the node is selected
			    so touch users can still reach it). Single click expands —
			    no double-click required. */}
			<button
				type="button"
				aria-label="Expand container"
				data-testid={`container-toggle-${props.id}`}
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
					{/* Truncated normally; expands to the full title on hover. */}
					<div className="truncate text-sm font-semibold group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
						{data.title || "Container"}
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
						data-testid={`container-progress-${props.id}`}
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

// Render one column of handles, evenly spaced down the side of the card. Each
// handle gets its `interfaceId` as the React Flow handle id so collapsed edges
// can attach to the correct port. When the container has no interfaces on this
// side yet (legacy data the backfill missed), still render a single unlabeled
// handle so edges have something to attach to.
function InterfaceRail({
	ports,
	side,
}: {
	ports: ContainerPort[];
	side: "left" | "right";
}) {
	const handleType = side === "left" ? "target" : "source";
	const position = side === "left" ? Position.Left : Position.Right;
	const list = ports.length > 0 ? ports : [{ id: "__default__", label: "" }];
	return (
		<>
			{list.map((port, i) => (
				<Handle
					key={port.id}
					id={port.id === "__default__" ? undefined : port.id}
					type={handleType}
					position={position}
					style={{ top: PORT_HEADER_OFFSET + i * PORT_GAP }}
					className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground"
					title={port.label || undefined}
				/>
			))}
		</>
	);
}

function ExpandedImpl(props: NodeProps) {
	const data = props.data as unknown as ContainerNodeData;
	const width = props.width ?? 320;
	const height = props.height ?? 200;
	// Children now sit at a higher zIndex (canvas buildNodes), so the
	// container body can take pointer events normally for selection + resize.
	// The header strip is the drag handle.
	return (
		<div
			data-testid={`container-expanded-${props.id}`}
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
					testId={`container-delete-${props.id}`}
				/>
			)}
			<div
				data-drag-handle="container-header"
				className="flex cursor-move items-center gap-1.5 border-b border-dashed bg-card/80 px-2 py-1 text-xs font-medium backdrop-blur-sm"
			>
				<button
					type="button"
					aria-label="Collapse container"
					data-testid={`container-toggle-${props.id}`}
					// nodrag tells React Flow not to start a node-drag when the
					// pointer goes down on this button, so the collapse toggle
					// still works once the container itself is draggable.
					className="nodrag grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent"
					onClick={(e) => {
						e.stopPropagation();
						data.onToggle();
					}}
				>
					<ChevronDownIcon className="size-3.5" />
				</button>
				<FolderIcon className="size-3.5 text-muted-foreground" />
				{/* Truncated normally; expands to the full title on hover. */}
				<span className="truncate group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
					{data.title || "Container"}
				</span>
			</div>
		</div>
	);
}

export const ContainerCollapsedNode = memo(CollapsedImpl);
export const ContainerExpandedNode = memo(ExpandedImpl);

function fmt(n: number): string {
	const snapped = Math.abs(n) < 1e-6 ? 0 : n;
	if (Number.isInteger(snapped)) return snapped.toString();
	return snapped.toFixed(2);
}

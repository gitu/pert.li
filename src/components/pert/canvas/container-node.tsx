import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FolderIcon,
	ZapIcon,
} from "lucide-react";
import { memo } from "react";
import type { ContainerRollup } from "#/lib/pert/projection";
import { cn } from "#/lib/utils";

// Two related node renderings for a container task:
//  - "container-collapsed" — single card showing aggregate stats.
//  - "container-expanded" — translucent labelled panel that sits behind its
//    descendants on the canvas so they read as a group. Descendants are
//    still ordinary React Flow nodes; the panel is just a visual wrapper.

export type ContainerNodeData = {
	title: string;
	rollup: ContainerRollup | null;
	collapsed: boolean;
	onToggle: () => void;
};

function CollapsedImpl(props: NodeProps) {
	const data = props.data as unknown as ContainerNodeData;
	const rollup = data.rollup;
	const critical = rollup?.hasCritical ?? false;
	return (
		<div
			data-testid={`container-collapsed-${props.id}`}
			data-critical={critical}
			className={cn(
				"min-h-[80px] w-[220px] rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm",
				critical
					? "border-destructive ring-1 ring-destructive/40"
					: "border-border",
				props.selected && "ring-2 ring-primary",
			)}
		>
			<Handle
				type="target"
				position={Position.Left}
				className="!h-3 !w-3 !rounded-full !border-2 !border-background !bg-muted-foreground"
			/>
			<div className="flex items-start gap-2">
				<button
					type="button"
					aria-label="Expand container"
					data-testid={`container-toggle-${props.id}`}
					className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
					onClick={(e) => {
						e.stopPropagation();
						data.onToggle();
					}}
				>
					<ChevronRightIcon className="size-3.5" />
				</button>
				<FolderIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold">
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
					</div>
				</div>
			</div>
			<Handle
				type="source"
				position={Position.Right}
				className="!h-3 !w-3 !rounded-full !border-2 !border-background !bg-muted-foreground"
			/>
		</div>
	);
}

function ExpandedImpl(props: NodeProps) {
	const data = props.data as unknown as ContainerNodeData;
	const width = props.width ?? 320;
	const height = props.height ?? 200;
	// Body uses pointer-events: none so leaves rendered underneath inside the
	// container's bounds still receive their own clicks; only the header strip
	// re-enables pointer events so its collapse button stays interactive even
	// when a leaf happens to overlap the container.
	return (
		<div
			data-testid={`container-expanded-${props.id}`}
			className={cn(
				"pointer-events-none rounded-lg border border-dashed bg-muted/20",
				props.selected && "ring-2 ring-primary",
			)}
			style={{ width, height }}
		>
			<div
				data-drag-handle="container-header"
				className="pointer-events-auto flex cursor-move items-center gap-1.5 border-b border-dashed bg-card/80 px-2 py-1 text-xs font-medium backdrop-blur-sm"
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
				<span className="truncate">{data.title || "Container"}</span>
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

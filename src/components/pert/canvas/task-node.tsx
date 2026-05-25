import { Handle, type NodeProps, Position } from "@xyflow/react";
import { AlertOctagonIcon, CircleDotIcon, ZapIcon } from "lucide-react";
import { memo } from "react";
import { PresenceBadge } from "#/components/pert/presence/presence-badge";
import { cn } from "#/lib/utils";

export type TaskNodeData = {
	title: string;
	kind: "task" | "milestone";
	durationDays: number;
	slackDays: number | null;
	critical: boolean;
	hasEstimate: boolean;
	cycle?: boolean;
};

// Custom React Flow node rendering a single task. Slack and critical state
// come from the Phase 3 CPM engine, not stored in the Automerge doc.
function TaskNodeImpl(props: NodeProps) {
	const data = props.data as unknown as TaskNodeData;
	const isMilestone = data.kind === "milestone";

	return (
		<div
			data-testid={`task-node-${props.id}`}
			data-critical={data.critical}
			data-cycle={data.cycle ? "true" : undefined}
			className={cn(
				"group relative min-h-[80px] w-[200px] rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm transition-colors",
				data.cycle
					? "border-destructive ring-2 ring-destructive/60 bg-destructive/5"
					: data.critical
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
				{data.cycle ? (
					<AlertOctagonIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				) : isMilestone ? (
					<CircleDotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				) : data.critical ? (
					<ZapIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				) : (
					<div className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" />
				)}
				<div className="min-w-0 flex-1">
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
								<span>{data.hasEstimate ? fmt(data.durationDays) : "?"} d</span>
								{!data.cycle && data.slackDays !== null && !data.critical && (
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
				</div>
			</div>
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

export const TaskNode = memo(TaskNodeImpl);

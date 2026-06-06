import { AlertOctagonIcon, RotateCcwIcon, ScissorsIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "#/components/ui/button";
import {
	describeEdge,
	dropDependencyMutation,
	findCycleEdges,
	suggestCycleBreakEdge,
} from "#/lib/pert/cycle";
import { selectTask } from "#/lib/pert/store";
import type { PertDoc, TaskId } from "#/lib/pert/types";

// Top-of-canvas banner that appears whenever the schedule engine reports a
// cycle. Shows the human path (A → B → C → A) and offers a one-click
// auto-fix: drop the dependency whose removal restores the schedule.
// Falls back to "no clean break" when the graph has multiple cycles a
// single edge can't fix.

export type CycleBannerProps = {
	projectId: string;
	doc: PertDoc;
	cycle: TaskId[];
	changeDoc: (mutate: (doc: PertDoc) => void) => void;
};

export function CycleBanner({
	projectId,
	doc,
	cycle,
	changeDoc,
}: CycleBannerProps) {
	const suggestion = useMemo(
		() => suggestCycleBreakEdge(doc, cycle),
		[doc, cycle],
	);
	const cycleEdges = useMemo(() => findCycleEdges(doc, cycle), [doc, cycle]);

	const handleAutoFix = () => {
		if (!suggestion) return;
		changeDoc(dropDependencyMutation(suggestion.dependencyId));
	};

	const handleDropOther = (depId: string) => {
		changeDoc(dropDependencyMutation(depId));
	};

	const handleSelectTask = (taskId: TaskId) => {
		selectTask(projectId, taskId);
	};

	return (
		<div
			role="alert"
			data-testid="cycle-banner"
			className="pointer-events-auto w-[min(720px,calc(100vw-32px))] space-y-2 rounded-md border border-destructive/50 bg-[color-mix(in_oklab,var(--destructive)_10%,var(--background))] px-3 py-2 shadow-md"
		>
			<div className="flex items-start gap-2">
				<AlertOctagonIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				<div className="min-w-0 flex-1 space-y-1">
					<div className="text-xs font-semibold text-destructive">
						Dependency cycle — schedule unavailable
					</div>
					<div className="break-words text-xs text-foreground/80">
						<span className="text-muted-foreground">Path: </span>
						{/* The CPM walker returns a closed cycle (first id duplicated
						    at the end). Render only the distinct prefix, then append
						    the closing arrow + first id again so the loop reads
						    naturally without colliding React keys. */}
						{cycle.slice(0, -1).map((id) => (
							<span key={id}>
								<button
									type="button"
									onClick={() => handleSelectTask(id)}
									className="font-medium underline-offset-2 hover:underline"
									data-testid={`cycle-banner-task-${id}`}
								>
									{titleOf(doc, id)}
								</button>
								<span aria-hidden className="px-1 text-muted-foreground">
									→
								</span>
							</span>
						))}
						<span className="font-medium" data-testid="cycle-banner-close">
							{titleOf(doc, cycle[0])}
						</span>
					</div>
				</div>
				{suggestion ? (
					<Button
						type="button"
						size="sm"
						variant="destructive"
						className="h-7 shrink-0 gap-1 text-[11px]"
						onClick={handleAutoFix}
						data-testid="cycle-banner-autofix"
						title={`Drop ${describeEdge(doc, suggestion)}`}
					>
						<ScissorsIcon className="size-3" />
						Drop {describeEdge(doc, suggestion)}
					</Button>
				) : (
					<span className="shrink-0 rounded bg-destructive/15 px-2 py-1 text-[10px] uppercase tracking-wide text-destructive">
						No single-edge fix
					</span>
				)}
			</div>
			{cycleEdges.length > 1 && (
				<div className="flex flex-wrap items-center gap-1 pl-6 text-[11px] text-muted-foreground">
					<span>Other cycle edges:</span>
					{cycleEdges
						.filter((e) => e.dependencyId !== suggestion?.dependencyId)
						.map((edge) => (
							<button
								key={edge.dependencyId}
								type="button"
								onClick={() => handleDropOther(edge.dependencyId)}
								className="inline-flex items-center gap-1 rounded border border-destructive/30 px-1.5 py-0.5 text-foreground/80 hover:bg-destructive/10"
								data-testid={`cycle-banner-drop-${edge.dependencyId}`}
								title={`Drop ${describeEdge(doc, edge)}`}
							>
								<RotateCcwIcon className="size-3" />
								{describeEdge(doc, edge)}
							</button>
						))}
				</div>
			)}
		</div>
	);
}

function titleOf(doc: PertDoc, taskId: TaskId): string {
	return doc.tasksById[taskId]?.title || taskId;
}

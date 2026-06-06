import {
	AlertTriangleIcon,
	CalendarRangeIcon,
	GitBranchIcon,
	LayersIcon,
	ListChecksIcon,
	MilestoneIcon,
	RouteIcon,
} from "lucide-react";
import { Progress } from "#/components/ui/progress";
import type { ProjectOverview } from "#/lib/pert/overview";

// The "key figures" grid. Pure presentation over a computed ProjectOverview —
// no doc access, so it's trivial to story in every state.

export function OverviewMetrics({ overview }: { overview: ProjectOverview }) {
	const sched = overview.schedule;
	return (
		<div className="space-y-3" data-testid="overview-metrics">
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
				<Metric
					Icon={ListChecksIcon}
					label="Tasks"
					value={overview.taskCount}
				/>
				<Metric
					Icon={MilestoneIcon}
					label="Milestones"
					value={overview.milestoneCount}
				/>
				<Metric
					Icon={LayersIcon}
					label="Containers"
					value={overview.containerCount}
				/>
				<Metric
					Icon={GitBranchIcon}
					label="Dependencies"
					value={overview.dependencyCount}
				/>
				{sched.ok ? (
					<>
						<Metric
							Icon={CalendarRangeIcon}
							label="Duration"
							value={`${formatDays(sched.durationDays)}d`}
							hint={`${sched.startDate} → ${sched.finishDate}`}
						/>
						<Metric
							Icon={RouteIcon}
							label="On critical path"
							value={sched.criticalCount}
						/>
					</>
				) : (
					<div className="col-span-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive sm:col-span-3 lg:col-span-2">
						<AlertTriangleIcon className="size-4 shrink-0" />
						<span>
							Dependency cycle ({sched.cycle.length} tasks) — fix it in the
							Network or Matrix view to compute a schedule.
						</span>
					</div>
				)}
			</div>

			<div className="rounded-md border bg-card/40 p-3">
				<div className="mb-1.5 flex items-center justify-between text-xs">
					<span className="font-medium">Progress</span>
					<span className="tabular-nums text-muted-foreground">
						{Math.round(overview.progressPct)}%
					</span>
				</div>
				<Progress value={overview.progressPct} className="h-2" />
				<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span>
						<span className="tabular-nums text-foreground">
							{overview.status.completed}
						</span>{" "}
						completed
					</span>
					<span>
						<span className="tabular-nums text-foreground">
							{overview.status.inProgress}
						</span>{" "}
						in progress
					</span>
					<span>
						<span className="tabular-nums text-foreground">
							{overview.status.notStarted}
						</span>{" "}
						not started
					</span>
				</div>
			</div>
		</div>
	);
}

function Metric({
	Icon,
	label,
	value,
	hint,
}: {
	Icon: typeof ListChecksIcon;
	label: string;
	value: string | number;
	hint?: string;
}) {
	return (
		<div className="rounded-md border bg-card/40 p-3">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Icon className="size-3.5" />
				{label}
			</div>
			<div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
			{hint && (
				<div
					className="mt-0.5 truncate text-xs text-muted-foreground"
					title={hint}
				>
					{hint}
				</div>
			)}
		</div>
	);
}

function formatDays(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

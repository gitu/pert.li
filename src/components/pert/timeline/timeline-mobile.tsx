import { useStore } from "@tanstack/react-store";
import { CircleDotIcon, ZapIcon } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "#/components/ui/badge";
import { computeSchedule } from "#/lib/pert/schedule";
import { selectionStore, selectTask } from "#/lib/pert/store";
import { buildTimelineModel, type TimelineLane } from "#/lib/pert/timeline";
import type { PertDoc } from "#/lib/pert/types";
import { groupLanesByWeek } from "#/lib/pert/week-group";
import { cn } from "#/lib/utils";

// Mobile replacement for the desktop SVG Gantt strip. Stacks tasks into
// weekly groups with sticky headers — `buildTimelineModel` already returns
// lanes sorted by earliestStart/Finish, so within a week the order matches
// what the desktop Timeline shows.

export type TimelineMobileProps = {
	projectId: string;
	doc: PertDoc;
};

export function TimelineMobile({ projectId, doc }: TimelineMobileProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const model = useMemo(
		() => buildTimelineModel(doc, scheduleResult),
		[doc, scheduleResult],
	);
	const groups = useMemo(() => groupLanesByWeek(model.lanes), [model.lanes]);
	const selectedId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	if (model.cycle) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-sm text-destructive">
				The project has a dependency cycle. Resolve it in the Network view to
				see the timeline.
			</div>
		);
	}
	if (groups.length === 0) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
				Nothing scheduled yet.
			</div>
		);
	}

	return (
		<div data-testid="timeline-mobile" className="h-full overflow-y-auto">
			{groups.map((group) => (
				<section key={group.weekStart} className="border-b">
					<header className="sticky top-0 z-10 bg-card/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
						Week of {formatHeaderDate(group.weekStart)}
					</header>
					<ul className="flex flex-col">
						{group.lanes.map((lane) => (
							<TimelineRow
								key={lane.taskId}
								lane={lane}
								selected={lane.taskId === selectedId}
								onSelect={() => selectTask(projectId, lane.taskId)}
							/>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

function TimelineRow({
	lane,
	selected,
	onSelect,
}: {
	lane: TimelineLane;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				data-testid={`timeline-mobile-row-${lane.taskId}`}
				className={cn(
					"flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
					selected ? "bg-primary/10 text-foreground" : "active:bg-accent/40",
				)}
			>
				{lane.critical ? (
					<ZapIcon className="size-4 shrink-0 text-destructive" />
				) : (
					<CircleDotIcon className="size-4 shrink-0 text-muted-foreground" />
				)}
				<div className="min-w-0 flex-1">
					<div className="truncate font-medium">{lane.title || "Untitled"}</div>
					<div className="text-[11px] text-muted-foreground">
						{formatHeaderDate(lane.earliestStartDate)} →{" "}
						{formatHeaderDate(lane.earliestFinishDate)} ·{" "}
						{fmtDays(lane.duration)}d
					</div>
				</div>
				{lane.critical && (
					<Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
						critical
					</Badge>
				)}
			</button>
		</li>
	);
}

// Compact day count: integers render bare ("3d"), fractions to one decimal
// ("1.3d") so PERT three-point estimates don't bleed binary noise into the UI.
function fmtDays(n: number): string {
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

// "2026-05-25" → "May 25". Kept locale-free on purpose: tests run in any
// locale and the doc dates are already ISO. Year is omitted unless the
// group crosses into a different one — for now we always show month+day.
function formatHeaderDate(iso: string): string {
	const date = new Date(`${iso}T00:00:00Z`);
	const month = date.toLocaleString("en-US", {
		month: "short",
		timeZone: "UTC",
	});
	return `${month} ${date.getUTCDate()}`;
}

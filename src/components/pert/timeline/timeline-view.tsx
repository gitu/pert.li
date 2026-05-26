import { useStore } from "@tanstack/react-store";
import { CircleDotIcon, LayersIcon, ZapIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { computeSchedule } from "#/lib/pert/schedule";
import { selectionStore, selectTask } from "#/lib/pert/store";
import { parseKeySegments } from "#/lib/pert/task-key";
import {
	buildTimelineModel,
	type TimelineLane,
	timelineTicks,
} from "#/lib/pert/timeline";
import type { PertDoc } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Timeline strip: one row per leaf/milestone, x-axis = days from project
// start, critical path lit. Selection is shared with the rest of the views
// via selectionStore. No estimate editing here — that's the inspector job.

export type TimelineViewProps = {
	projectId: string;
	doc: PertDoc;
};

const LANE_HEIGHT = 32;
const LANE_GAP = 4;
const LABEL_WIDTH = 200;
const AXIS_HEIGHT = 28;
const MIN_BAR_WIDTH = 4;

export function TimelineView({ projectId, doc }: TimelineViewProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const model = useMemo(
		() => buildTimelineModel(doc, scheduleResult),
		[doc, scheduleResult],
	);
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	// Optional grouping: re-sorts lanes by their dotted key (parseKeySegments
	// → lexicographic) and renders a heavy horizontal divider between adjacent
	// groups. Off by default so the strip stays time-ordered for users who
	// don't use keys.
	const [grouped, setGrouped] = useState(false);
	const orderedLanes = useMemo(
		() => orderLanes(model.lanes, grouped),
		[model.lanes, grouped],
	);
	const groupBoundaries = useMemo(() => {
		if (!grouped) return new Set<number>();
		return computeGroupBoundaries(orderedLanes);
	}, [grouped, orderedLanes]);

	return (
		<div
			className="flex h-full flex-col overflow-hidden"
			data-testid="timeline-view"
		>
			<header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Timeline · {model.lanes.length} tasks
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant={grouped ? "default" : "outline"}
						size="sm"
						className="h-7 gap-1.5 text-xs"
						onClick={() => setGrouped((g) => !g)}
						aria-pressed={grouped}
						data-testid="timeline-group"
						title={
							grouped
								? "Stop grouping; restore start-day order"
								: "Sort lanes by their dotted key and draw group boundaries"
						}
					>
						<LayersIcon className="size-3.5" />
						{grouped ? "Grouped" : "Group"}
					</Button>
					{model.cycle ? (
						<span className="text-xs text-destructive">
							Cycle detected — schedule unavailable
						</span>
					) : (
						<span className="text-xs text-muted-foreground">
							{fmt(model.projectDuration)} d ·{" "}
							<span className="tabular-nums">{model.projectStartDate}</span> →{" "}
							<span className="tabular-nums">{model.projectFinishDate}</span>
						</span>
					)}
				</div>
			</header>
			<div className="flex-1 overflow-auto p-4">
				{model.lanes.length === 0 ? (
					<EmptyTimeline cycle={model.cycle} />
				) : (
					<TimelineStrip
						lanes={orderedLanes}
						axisMax={model.axisMax}
						projectDuration={model.projectDuration}
						selectedTaskId={selectedTaskId}
						groupBoundaries={groupBoundaries}
						showKeys={grouped}
						onSelect={(taskId) => selectTask(projectId, taskId)}
					/>
				)}
			</div>
		</div>
	);
}

// Mirrors the matrix-view's ordering: by dotted key segments, numeric-aware,
// keyless tasks sink to the end. Returns a new array; never mutates input.
function orderLanes(lanes: TimelineLane[], grouped: boolean): TimelineLane[] {
	if (!grouped) return lanes;
	const annotated = lanes.map((l, idx) => ({
		l,
		idx,
		segs: parseKeySegments(l.key),
	}));
	annotated.sort((a, b) => {
		if (a.segs.length === 0 && b.segs.length > 0) return 1;
		if (b.segs.length === 0 && a.segs.length > 0) return -1;
		for (let i = 0; i < Math.min(a.segs.length, b.segs.length); i++) {
			const cmp = a.segs[i].localeCompare(b.segs[i], undefined, {
				numeric: true,
			});
			if (cmp !== 0) return cmp;
		}
		if (a.segs.length !== b.segs.length) {
			return a.segs.length - b.segs.length;
		}
		// Within the same group, fall back to start-day order so the bars
		// still read left-to-right within a group rather than alphabetised.
		if (a.l.earliestStart !== b.l.earliestStart)
			return a.l.earliestStart - b.l.earliestStart;
		return a.l.title.localeCompare(b.l.title);
	});
	return annotated.map((a) => a.l);
}

// Indices where the first dotted-key segment changes between adjacent lanes.
// Used to draw a heavier horizontal divider between groups.
function computeGroupBoundaries(lanes: TimelineLane[]): Set<number> {
	const out = new Set<number>();
	for (let i = 1; i < lanes.length; i++) {
		const prev = parseKeySegments(lanes[i - 1].key)[0] ?? "";
		const curr = parseKeySegments(lanes[i].key)[0] ?? "";
		if (prev !== curr) out.add(i);
	}
	return out;
}

function TimelineStrip({
	lanes,
	axisMax,
	projectDuration,
	selectedTaskId,
	groupBoundaries,
	showKeys,
	onSelect,
}: {
	lanes: TimelineLane[];
	axisMax: number;
	projectDuration: number;
	selectedTaskId: string | null;
	// Indices at which a group boundary starts. The lane at that index renders
	// a heavy top divider. Empty set when grouping is off.
	groupBoundaries: Set<number>;
	// When true, the lane label is prefixed with the task's dotted key in a
	// muted monospace tag, mirroring the matrix's grouped-row style.
	showKeys: boolean;
	onSelect: (taskId: string) => void;
}) {
	const ticks = useMemo(() => timelineTicks(axisMax), [axisMax]);
	const height = AXIS_HEIGHT + lanes.length * (LANE_HEIGHT + LANE_GAP);

	return (
		<svg
			role="img"
			aria-label={`Timeline of ${lanes.length} tasks across ${fmt(axisMax)} days`}
			width="100%"
			height={height}
			viewBox={`0 0 1000 ${height}`}
			preserveAspectRatio="none"
			className="block min-w-[640px] font-sans"
			data-testid="timeline-svg"
		>
			<title>Timeline of {lanes.length} tasks</title>
			{/* Axis grid */}
			<g>
				{ticks.map((tick) => {
					const x = LABEL_WIDTH + (tick / axisMax) * (1000 - LABEL_WIDTH);
					return (
						<g key={`tick-${tick}`}>
							<line
								x1={x}
								y1={0}
								x2={x}
								y2={height}
								className="stroke-border"
								strokeWidth={0.5}
							/>
							<text
								x={x}
								y={AXIS_HEIGHT - 8}
								textAnchor="middle"
								className="fill-muted-foreground text-[10px]"
							>
								d{fmt(tick)}
							</text>
						</g>
					);
				})}
				<line
					x1={LABEL_WIDTH}
					y1={AXIS_HEIGHT}
					x2={1000}
					y2={AXIS_HEIGHT}
					className="stroke-border"
				/>
				{/* Project end marker */}
				{projectDuration > 0 && (
					<line
						x1={
							LABEL_WIDTH + (projectDuration / axisMax) * (1000 - LABEL_WIDTH)
						}
						y1={AXIS_HEIGHT}
						x2={
							LABEL_WIDTH + (projectDuration / axisMax) * (1000 - LABEL_WIDTH)
						}
						y2={height}
						className="stroke-destructive/60"
						strokeDasharray="4 4"
					/>
				)}
			</g>
			{/* Lanes */}
			{lanes.map((lane, i) => {
				const top = AXIS_HEIGHT + i * (LANE_HEIGHT + LANE_GAP);
				const xStart =
					LABEL_WIDTH + (lane.earliestStart / axisMax) * (1000 - LABEL_WIDTH);
				const xFinish =
					LABEL_WIDTH + (lane.earliestFinish / axisMax) * (1000 - LABEL_WIDTH);
				const barWidth = Math.max(xFinish - xStart, MIN_BAR_WIDTH);
				const isSelected = lane.taskId === selectedTaskId;
				const isMilestone = lane.kind === "milestone";
				const isGroupBoundary = groupBoundaries.has(i);

				return (
					<g
						key={lane.taskId}
						data-testid={`timeline-lane-${lane.taskId}`}
						data-selected={isSelected}
						data-critical={lane.critical}
						data-group-boundary={isGroupBoundary || undefined}
					>
						{isGroupBoundary && (
							<line
								x1={0}
								y1={top - LANE_GAP / 2}
								x2={1000}
								y2={top - LANE_GAP / 2}
								className="stroke-foreground/30"
								strokeWidth={1.5}
							/>
						)}
						<rect
							x={0}
							y={top}
							width={1000}
							height={LANE_HEIGHT}
							className={cn("fill-transparent", isSelected && "fill-accent/40")}
						/>
						{/* Bar (or milestone diamond) — purely decorative; the
						    overlay button below catches all pointer events. */}
						{isMilestone ? (
							<g transform={`translate(${xStart}, ${top + LANE_HEIGHT / 2})`}>
								<polygon
									points="-6,0 0,-6 6,0 0,6"
									className={cn(
										lane.critical
											? "fill-destructive"
											: "fill-muted-foreground",
									)}
								/>
							</g>
						) : (
							<rect
								x={xStart}
								y={top + 6}
								width={barWidth}
								height={LANE_HEIGHT - 12}
								rx={3}
								className={cn(
									lane.critical
										? "fill-destructive/80 stroke-destructive"
										: "fill-primary/70 stroke-primary",
								)}
								strokeWidth={1}
							/>
						)}
						{/* Duration label */}
						{!isMilestone && barWidth > 32 && (
							<text
								x={xStart + barWidth / 2}
								y={top + LANE_HEIGHT / 2 + 4}
								textAnchor="middle"
								className="pointer-events-none fill-primary-foreground text-[10px] font-medium"
							>
								{fmt(lane.duration)}d
							</text>
						)}
						{/* Full-width interactive overlay — HTML button inside a
						    foreignObject so a11y stays correct without fighting
						    biome's SVG-element-interaction lints. */}
						<foreignObject x={0} y={top} width={1000} height={LANE_HEIGHT}>
							<button
								type="button"
								onClick={() => onSelect(lane.taskId)}
								aria-pressed={isSelected}
								className={cn(
									"flex h-full w-full items-center gap-1.5 truncate bg-transparent pl-2 text-left text-xs",
									isSelected && "font-medium",
								)}
								style={{ paddingRight: 1000 - LABEL_WIDTH + 4 }}
							>
								{isMilestone ? (
									<CircleDotIcon className="size-3 shrink-0 text-muted-foreground" />
								) : lane.critical ? (
									<ZapIcon className="size-3 shrink-0 text-destructive" />
								) : (
									<span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
								)}
								{showKeys && lane.key && (
									<span className="shrink-0 font-mono text-[9px] text-muted-foreground">
										{lane.key}
									</span>
								)}
								<span className="truncate">{lane.title}</span>
							</button>
						</foreignObject>
					</g>
				);
			})}
		</svg>
	);
}

function EmptyTimeline({ cycle }: { cycle: boolean }) {
	return (
		<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
			<div className="max-w-sm space-y-1">
				{cycle ? (
					<>
						<p className="font-medium text-foreground">Cycle detected.</p>
						<p>Resolve the cycle in the Network view to see a timeline.</p>
					</>
				) : (
					<>
						<p className="font-medium text-foreground">No tasks yet.</p>
						<p>Add tasks from the Network view and they'll line up here.</p>
					</>
				)}
			</div>
		</div>
	);
}

function fmt(n: number): string {
	const snapped = Math.abs(n) < 1e-6 ? 0 : n;
	if (Number.isInteger(snapped)) return snapped.toString();
	return snapped.toFixed(2);
}

import { useStore } from "@tanstack/react-store";
import { CircleDotIcon, LayersIcon, ZapIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { computeSchedule } from "#/lib/pert/schedule";
import { selectionStore, selectTask } from "#/lib/pert/store";
import {
	countRowsInGroup,
	groupTasksByKey,
	type KeyGroupNode,
} from "#/lib/pert/task-key";
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
const HEADER_HEIGHT = 22;
const LABEL_WIDTH = 200;
const AXIS_HEIGHT = 28;
const MIN_BAR_WIDTH = 4;
// How far each nesting level pushes the lane / header label to the right.
const INDENT_PX = 14;

export function TimelineView({ projectId, doc }: TimelineViewProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const model = useMemo(
		() => buildTimelineModel(doc, scheduleResult),
		[doc, scheduleResult],
	);
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	// Optional grouping: nests lanes under header rows derived from each
	// task's dotted key (M1, M1.API, M1.API.foo …). Off by default so the
	// strip stays time-ordered for users who don't use keys.
	const [grouped, setGrouped] = useState(false);
	const rows = useMemo(
		() => buildRows(model.lanes, grouped),
		[model.lanes, grouped],
	);

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
								: "Nest lanes under headers derived from their dotted keys"
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
						rows={rows}
						axisMax={model.axisMax}
						projectDuration={model.projectDuration}
						selectedTaskId={selectedTaskId}
						onSelect={(taskId) => selectTask(projectId, taskId)}
					/>
				)}
			</div>
		</div>
	);
}

// Renderable row in the strip. Header rows label a group node; lane rows
// render the actual Gantt bar. `depth` is the nesting level (0 = top-level)
// — used by both kinds to indent their label, and by headers to decide how
// heavy the top divider should be (deeper = lighter).
type HeaderRow = {
	type: "header";
	depth: number;
	label: string;
	path: string;
	count: number;
};
type LaneRow = {
	type: "lane";
	depth: number;
	lane: TimelineLane;
};
type TimelineRow = HeaderRow | LaneRow;

// When grouping is off we still want a single LaneRow per lane (depth 0,
// no headers) so the renderer can stay row-list-driven. When grouping is on
// we delegate to `groupTasksByKey` (the same helper the table uses) and
// flatten the resulting tree depth-first: header for the group, then its
// own rows, then recurse into children.
function buildRows(lanes: TimelineLane[], grouped: boolean): TimelineRow[] {
	if (!grouped) {
		return lanes.map((lane) => ({ type: "lane", depth: 0, lane }));
	}
	const tree = groupTasksByKey(lanes);
	const rows: TimelineRow[] = [];
	for (const node of tree) flattenNode(node, 0, rows);
	return rows;
}

function flattenNode(
	node: KeyGroupNode<TimelineLane>,
	depth: number,
	out: TimelineRow[],
): void {
	out.push({
		type: "header",
		depth,
		label: node.label,
		path: node.path,
		count: countRowsInGroup(node),
	});
	for (const lane of node.rows) {
		out.push({ type: "lane", depth: depth + 1, lane });
	}
	for (const child of node.children) {
		flattenNode(child, depth + 1, out);
	}
}

function rowHeight(row: TimelineRow): number {
	return row.type === "header" ? HEADER_HEIGHT : LANE_HEIGHT;
}

function TimelineStrip({
	rows,
	axisMax,
	projectDuration,
	selectedTaskId,
	onSelect,
}: {
	rows: TimelineRow[];
	axisMax: number;
	projectDuration: number;
	selectedTaskId: string | null;
	onSelect: (taskId: string) => void;
}) {
	const ticks = useMemo(() => timelineTicks(axisMax), [axisMax]);
	// Pre-compute the y-offset of each row (rows have variable heights —
	// headers are shorter than lanes). Last entry of `tops` is the total
	// stack height below the axis.
	const tops = useMemo(() => {
		const out: number[] = [];
		let cursor = AXIS_HEIGHT;
		for (const row of rows) {
			out.push(cursor);
			cursor += rowHeight(row) + LANE_GAP;
		}
		out.push(cursor);
		return out;
	}, [rows]);
	const height = tops[tops.length - 1];
	const laneCount = rows.reduce((n, r) => (r.type === "lane" ? n + 1 : n), 0);

	return (
		<svg
			role="img"
			aria-label={`Timeline of ${laneCount} tasks across ${fmt(axisMax)} days`}
			width="100%"
			height={height}
			viewBox={`0 0 1000 ${height}`}
			preserveAspectRatio="none"
			className="block min-w-[640px] font-sans"
			data-testid="timeline-svg"
		>
			<title>Timeline of {laneCount} tasks</title>
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
			{/* Rows — group headers + lanes, in render order */}
			{rows.map((row, i) => {
				const top = tops[i];
				if (row.type === "header") {
					return <HeaderRowG key={`hdr-${row.path}`} row={row} top={top} />;
				}
				return (
					<LaneRowG
						key={`lane-${row.lane.taskId}`}
						row={row}
						top={top}
						axisMax={axisMax}
						isSelected={row.lane.taskId === selectedTaskId}
						onSelect={onSelect}
					/>
				);
			})}
		</svg>
	);
}

function HeaderRowG({ row, top }: { row: HeaderRow; top: number }) {
	const indent = row.depth * INDENT_PX;
	return (
		<g data-testid={`timeline-header-${row.path}`} data-depth={row.depth}>
			{/* Heavier divider for top-level groups; lighter for deeper nests. */}
			<line
				x1={0}
				y1={top}
				x2={1000}
				y2={top}
				className={cn(
					row.depth === 0 ? "stroke-foreground/40" : "stroke-border",
				)}
				strokeWidth={row.depth === 0 ? 1.5 : 1}
			/>
			<foreignObject x={0} y={top} width={LABEL_WIDTH} height={HEADER_HEIGHT}>
				<div
					className="flex h-full items-center gap-1.5 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
					style={{ paddingLeft: 8 + indent }}
				>
					<span className="truncate font-mono normal-case tracking-normal">
						{row.label}
					</span>
					<span className="text-muted-foreground/70">({row.count})</span>
				</div>
			</foreignObject>
		</g>
	);
}

function LaneRowG({
	row,
	top,
	axisMax,
	isSelected,
	onSelect,
}: {
	row: LaneRow;
	top: number;
	axisMax: number;
	isSelected: boolean;
	onSelect: (taskId: string) => void;
}) {
	const { lane, depth } = row;
	const xStart =
		LABEL_WIDTH + (lane.earliestStart / axisMax) * (1000 - LABEL_WIDTH);
	const xFinish =
		LABEL_WIDTH + (lane.earliestFinish / axisMax) * (1000 - LABEL_WIDTH);
	const barWidth = Math.max(xFinish - xStart, MIN_BAR_WIDTH);
	const isMilestone = lane.kind === "milestone";
	const indent = depth * INDENT_PX;

	return (
		<g
			data-testid={`timeline-lane-${lane.taskId}`}
			data-selected={isSelected}
			data-critical={lane.critical}
			data-depth={depth}
		>
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
							lane.critical ? "fill-destructive" : "fill-muted-foreground",
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
			<foreignObject x={0} y={top} width={1000} height={LANE_HEIGHT}>
				<button
					type="button"
					onClick={() => onSelect(lane.taskId)}
					aria-pressed={isSelected}
					className={cn(
						"flex h-full w-full items-center gap-1.5 truncate bg-transparent text-left text-xs",
						isSelected && "font-medium",
					)}
					style={{
						paddingLeft: 8 + indent,
						paddingRight: 1000 - LABEL_WIDTH + 4,
					}}
				>
					{isMilestone ? (
						<CircleDotIcon className="size-3 shrink-0 text-muted-foreground" />
					) : lane.critical ? (
						<ZapIcon className="size-3 shrink-0 text-destructive" />
					) : (
						<span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
					)}
					<span className="truncate">{lane.title}</span>
				</button>
			</foreignObject>
		</g>
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

import { useStore } from "@tanstack/react-store";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CircleDotIcon,
	LayersIcon,
	MaximizeIcon,
	ZapIcon,
	ZoomInIcon,
	ZoomOutIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	buildGroupTree,
	countRowsInGroup,
	type KeyGroupNode,
} from "#/lib/pert/group-tree";
import { computeSchedule } from "#/lib/pert/schedule";
import { selectionStore, selectTask } from "#/lib/pert/store";
import {
	buildTimelineModel,
	type TimelineLane,
	timelineTicks,
} from "#/lib/pert/timeline";
import type { PertDoc } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Timeline strip: Gantt-style bars on a day axis. Day axis sticks to the
// top, the label column sticks to the left, and the bars area is a 2D
// scrollable canvas at a user-chosen pixels-per-day zoom. Selection is
// shared with the rest of the views via selectionStore. No estimate
// editing here — that's the inspector job.

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

// Zoom is expressed in pixels per day. The default is a sensible starting
// point; auto-fit runs once on mount to match the available viewport.
const DEFAULT_PX_PER_DAY = 32;
const MIN_PX_PER_DAY = 2;
const MAX_PX_PER_DAY = 240;
const ZOOM_STEP = 1.5;

export function TimelineView({ projectId, doc }: TimelineViewProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const model = useMemo(
		() => buildTimelineModel(doc, scheduleResult),
		[doc, scheduleResult],
	);
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	// Optional grouping: nests lanes under header rows for the group each task
	// belongs to. Off by default so the strip stays time-ordered for users who
	// don't use groups.
	const [grouped, setGrouped] = useState(false);

	// Per-group collapse, keyed by the group node's stable `path` (groupId or
	// "__ungrouped__"). Local state, like the task list — folding away a group
	// is a transient focus aid, not something worth persisting across remounts.
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
		() => new Set(),
	);
	const toggleGroup = useCallback((path: string) => {
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const rows = useMemo(
		() => buildRows(doc, model.lanes, grouped, collapsedGroups),
		[doc, model.lanes, grouped, collapsedGroups],
	);

	const scrollRef = useRef<HTMLDivElement>(null);
	const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX_PER_DAY);

	// Auto-fit once after first paint so the bars span the available
	// width without the user having to click Fit. `useEffect` (not
	// `useLayoutEffect`) so it's SSR-safe — the cost is a brief render at
	// DEFAULT_PX_PER_DAY before the fit value lands, which is fine. After
	// the first run the zoom is sticky: we don't refit on resize or doc
	// updates so manual zoom isn't clobbered while the user is working.
	const autoFittedRef = useRef(false);
	useEffect(() => {
		if (autoFittedRef.current) return;
		if (model.lanes.length === 0) return;
		const next = computeFitPxPerDay(scrollRef.current, model.axisMax);
		if (next != null) {
			setPxPerDay(next);
			autoFittedRef.current = true;
		}
	}, [model.lanes.length, model.axisMax]);

	const fit = () => {
		const next = computeFitPxPerDay(scrollRef.current, model.axisMax);
		if (next != null) setPxPerDay(next);
	};
	const zoomIn = () =>
		setPxPerDay((p) => Math.min(p * ZOOM_STEP, MAX_PX_PER_DAY));
	const zoomOut = () =>
		setPxPerDay((p) => Math.max(p / ZOOM_STEP, MIN_PX_PER_DAY));

	const hasLanes = model.lanes.length > 0;

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
								: "Nest lanes under headers for the group each task belongs to"
						}
					>
						<LayersIcon className="size-3.5" />
						{grouped ? "Grouped" : "Group"}
					</Button>
					<div className="flex items-center rounded-md border">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 rounded-r-none p-0"
							onClick={zoomOut}
							disabled={!hasLanes || pxPerDay <= MIN_PX_PER_DAY + 1e-3}
							data-testid="timeline-zoom-out"
							title="Zoom out"
							aria-label="Zoom out"
						>
							<ZoomOutIcon className="size-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 rounded-none border-x p-0"
							onClick={fit}
							disabled={!hasLanes}
							data-testid="timeline-zoom-fit"
							title="Fit timeline to width"
							aria-label="Fit timeline to width"
						>
							<MaximizeIcon className="size-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 rounded-l-none p-0"
							onClick={zoomIn}
							disabled={!hasLanes || pxPerDay >= MAX_PX_PER_DAY - 1e-3}
							data-testid="timeline-zoom-in"
							title="Zoom in"
							aria-label="Zoom in"
						>
							<ZoomInIcon className="size-3.5" />
						</Button>
					</div>
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
			<div ref={scrollRef} className="flex-1 overflow-auto">
				{hasLanes ? (
					<TimelineStrip
						rows={rows}
						axisMax={model.axisMax}
						projectDuration={model.projectDuration}
						pxPerDay={pxPerDay}
						selectedTaskId={selectedTaskId}
						onSelect={(taskId) => selectTask(projectId, taskId)}
						onToggleGroup={toggleGroup}
					/>
				) : (
					<EmptyTimeline cycle={model.cycle} />
				)}
			</div>
		</div>
	);
}

// Pick a pxPerDay that fills the bars area of the given scroll container.
// Returns null when we can't measure yet (no element, zero width before
// first paint, empty timeline). Caller should treat null as "skip".
function computeFitPxPerDay(
	container: HTMLElement | null,
	axisMax: number,
): number | null {
	if (!container) return null;
	const width = container.clientWidth;
	if (width <= 0 || axisMax <= 0) return null;
	// Leave a small right gutter so the project-end marker isn't flush
	// against the right edge / scrollbar.
	const available = width - LABEL_WIDTH - 16;
	if (available < 50) return MIN_PX_PER_DAY;
	return clamp(available / axisMax, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), hi);
}

// Renderable row in the strip. Header rows label a group node; lane rows
// render the actual Gantt bar. `depth` is the nesting level (0 = top-level)
// — used by both kinds to indent their label, and by headers to decide how
// heavy the top divider should be (deeper = lighter).
type HeaderRow = {
	type: "header";
	depth: number;
	label: string;
	number: string;
	path: string;
	count: number;
	collapsed: boolean;
};
type LaneRow = {
	type: "lane";
	depth: number;
	lane: TimelineLane;
};
type TimelineRow = HeaderRow | LaneRow;

// When grouping is off we still want a single LaneRow per lane (depth 0,
// no headers) so the renderer can stay row-list-driven. When grouping is on
// we delegate to `buildGroupTree` (the same helper the table uses) and
// flatten the resulting tree depth-first: header for the group, then its
// own rows, then recurse into children.
function buildRows(
	doc: PertDoc,
	lanes: TimelineLane[],
	grouped: boolean,
	collapsedGroups: ReadonlySet<string>,
): TimelineRow[] {
	if (!grouped) {
		return lanes.map((lane) => ({ type: "lane", depth: 0, lane }));
	}
	const tree = buildGroupTree(doc, lanes);
	const rows: TimelineRow[] = [];
	for (const node of tree) flattenNode(node, 0, rows, collapsedGroups);
	return rows;
}

// Header rows are always emitted; a collapsed group simply omits its own lanes
// and any nested subgroups, so the strip's label column and SVG bars (both
// driven by this flat list) stay in lock-step.
function flattenNode(
	node: KeyGroupNode<TimelineLane>,
	depth: number,
	out: TimelineRow[],
	collapsedGroups: ReadonlySet<string>,
): void {
	const collapsed = collapsedGroups.has(node.path);
	out.push({
		type: "header",
		depth,
		label: node.label,
		number: node.number,
		path: node.path,
		count: countRowsInGroup(node),
		collapsed,
	});
	if (collapsed) return;
	for (const lane of node.rows) {
		out.push({ type: "lane", depth: depth + 1, lane });
	}
	for (const child of node.children) {
		flattenNode(child, depth + 1, out, collapsedGroups);
	}
}

function rowHeight(row: TimelineRow): number {
	return row.type === "header" ? HEADER_HEIGHT : LANE_HEIGHT;
}

function TimelineStrip({
	rows,
	axisMax,
	projectDuration,
	pxPerDay,
	selectedTaskId,
	onSelect,
	onToggleGroup,
}: {
	rows: TimelineRow[];
	axisMax: number;
	projectDuration: number;
	pxPerDay: number;
	selectedTaskId: string | null;
	onSelect: (taskId: string) => void;
	onToggleGroup: (path: string) => void;
}) {
	const ticks = useMemo(() => timelineTicks(axisMax), [axisMax]);
	// Pre-compute the y-offset of each row. Heights are mixed (headers
	// are shorter than lanes); we add LANE_GAP *between* rows, not after
	// the last one, so the HTML label column (flex with gap) and the
	// SVG bars area share the same total height.
	const tops = useMemo(() => {
		const out: number[] = [];
		let cursor = 0;
		for (let i = 0; i < rows.length; i++) {
			out.push(cursor);
			cursor += rowHeight(rows[i]);
			if (i < rows.length - 1) cursor += LANE_GAP;
		}
		out.push(cursor);
		return out;
	}, [rows]);
	const rowsHeight = tops[tops.length - 1];
	// Floor the bars area so very short / 1-day projects still have a
	// usable click target before the user zooms in.
	const contentWidth = Math.max(axisMax * pxPerDay, 200);
	const laneCount = rows.reduce((n, r) => (r.type === "lane" ? n + 1 : n), 0);

	return (
		// No role="img" / aria-label here — the strip is no longer a
		// single image. The lane labels are real <button>s, so the
		// interactive contents carry their own semantics; an outer img
		// role would hide them from assistive tech.
		<div
			data-testid="timeline-svg"
			className="grid font-sans"
			style={{
				gridTemplateColumns: `${LABEL_WIDTH}px ${contentWidth}px`,
				gridTemplateRows: `${AXIS_HEIGHT}px ${rowsHeight}px`,
				width: LABEL_WIDTH + contentWidth,
			}}
		>
			{/* Top-left corner: sticky in both directions so neither axis nor
			    label column scrolls over it. */}
			<div
				className="sticky left-0 top-0 z-30 border-b border-r bg-background"
				style={{ gridArea: "1 / 1" }}
			/>

			{/* Axis: sticky top, scrolls horizontally with the bars below. */}
			<div
				className="sticky top-0 z-20 border-b bg-background"
				style={{ gridArea: "1 / 2", height: AXIS_HEIGHT }}
				data-testid="timeline-axis"
			>
				<svg
					width={contentWidth}
					height={AXIS_HEIGHT}
					className="block"
					aria-hidden="true"
				>
					{ticks.map((tick) => {
						const x = tick * pxPerDay;
						return (
							<g key={`axis-${tick}`}>
								<line
									x1={x}
									y1={AXIS_HEIGHT - 6}
									x2={x}
									y2={AXIS_HEIGHT}
									className="stroke-border"
									strokeWidth={0.5}
								/>
								<text
									x={x}
									y={AXIS_HEIGHT - 10}
									textAnchor="middle"
									className="fill-muted-foreground text-[10px]"
								>
									d{fmt(tick)}
								</text>
							</g>
						);
					})}
				</svg>
			</div>

			{/* Label column: sticky left, scrolls vertically with the bars
			    to its right. Rows are stacked in document order using a
			    flex gap that matches the SVG row gap. */}
			<div
				className="sticky left-0 z-10 flex flex-col border-r bg-background"
				style={{ gridArea: "2 / 1", gap: LANE_GAP }}
			>
				{rows.map((row) => {
					if (row.type === "header") {
						return (
							<HeaderLabel
								key={`hdr-${row.path}`}
								row={row}
								onToggle={onToggleGroup}
							/>
						);
					}
					return (
						<LaneLabel
							key={`lbl-${row.lane.taskId}`}
							row={row}
							isSelected={row.lane.taskId === selectedTaskId}
							onSelect={onSelect}
						/>
					);
				})}
			</div>

			{/* Bars: scrolls in both directions. Click on the row background
			    (anywhere along the row, not just the bar) selects the task. */}
			<svg
				style={{ gridArea: "2 / 2" }}
				width={contentWidth}
				height={rowsHeight}
				className="block"
				data-testid="timeline-bars"
			>
				<title>Timeline of {laneCount} tasks</title>
				{/* Vertical grid lines aligned with axis ticks. */}
				{ticks.map((tick) => {
					const x = tick * pxPerDay;
					return (
						<line
							key={`grid-${tick}`}
							x1={x}
							y1={0}
							x2={x}
							y2={rowsHeight}
							className="stroke-border"
							strokeWidth={0.5}
						/>
					);
				})}
				{/* Project end marker (dashed). */}
				{projectDuration > 0 && (
					<line
						x1={projectDuration * pxPerDay}
						y1={0}
						x2={projectDuration * pxPerDay}
						y2={rowsHeight}
						className="stroke-destructive/60"
						strokeDasharray="4 4"
					/>
				)}
				{/* Rows — group headers + lanes, in render order. */}
				{rows.map((row, i) => {
					const top = tops[i];
					if (row.type === "header") {
						return (
							<HeaderRowG
								key={`hdrb-${row.path}`}
								row={row}
								top={top}
								width={contentWidth}
							/>
						);
					}
					return (
						<LaneRowG
							key={`lnb-${row.lane.taskId}`}
							row={row}
							top={top}
							width={contentWidth}
							pxPerDay={pxPerDay}
							isSelected={row.lane.taskId === selectedTaskId}
							onSelect={onSelect}
						/>
					);
				})}
			</svg>
		</div>
	);
}

function HeaderLabel({
	row,
	onToggle,
}: {
	row: HeaderRow;
	onToggle: (path: string) => void;
}) {
	const indent = row.depth * INDENT_PX;
	return (
		<button
			type="button"
			data-testid={`timeline-header-${row.path}`}
			data-depth={row.depth}
			data-collapsed={row.collapsed}
			onClick={() => onToggle(row.path)}
			aria-expanded={!row.collapsed}
			title={row.collapsed ? "Expand group" : "Collapse group"}
			className={cn(
				"flex shrink-0 items-center gap-1.5 truncate border-t bg-transparent text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground",
				row.depth === 0 ? "border-foreground/40" : "border-border",
			)}
			style={{ height: HEADER_HEIGHT, paddingLeft: 8 + indent }}
		>
			{row.collapsed ? (
				<ChevronRightIcon className="size-3 shrink-0" />
			) : (
				<ChevronDownIcon className="size-3 shrink-0" />
			)}
			<span className="truncate font-mono normal-case tracking-normal">
				{row.number ? `${row.number} ${row.label}` : row.label}
			</span>
			<span className="text-muted-foreground/70">({row.count})</span>
		</button>
	);
}

function LaneLabel({
	row,
	isSelected,
	onSelect,
}: {
	row: LaneRow;
	isSelected: boolean;
	onSelect: (taskId: string) => void;
}) {
	const { lane, depth } = row;
	const isMilestone = lane.kind === "milestone";
	const indent = depth * INDENT_PX;
	return (
		<button
			type="button"
			data-testid={`timeline-lane-${lane.taskId}`}
			data-selected={isSelected}
			data-critical={lane.critical}
			data-depth={depth}
			onClick={() => onSelect(lane.taskId)}
			aria-pressed={isSelected}
			className={cn(
				"flex shrink-0 items-center gap-1.5 truncate bg-transparent text-left text-xs",
				isSelected && "bg-accent/40 font-medium",
			)}
			style={{
				height: LANE_HEIGHT,
				paddingLeft: 8 + indent,
				paddingRight: 4,
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
	);
}

function HeaderRowG({
	row,
	top,
	width,
}: {
	row: HeaderRow;
	top: number;
	width: number;
}) {
	return (
		<line
			x1={0}
			y1={top}
			x2={width}
			y2={top}
			className={cn(row.depth === 0 ? "stroke-foreground/40" : "stroke-border")}
			strokeWidth={row.depth === 0 ? 1.5 : 1}
		/>
	);
}

function LaneRowG({
	row,
	top,
	width,
	pxPerDay,
	isSelected,
	onSelect,
}: {
	row: LaneRow;
	top: number;
	width: number;
	pxPerDay: number;
	isSelected: boolean;
	onSelect: (taskId: string) => void;
}) {
	const { lane } = row;
	const xStart = lane.earliestStart * pxPerDay;
	const xFinish = lane.earliestFinish * pxPerDay;
	const barWidth = Math.max(xFinish - xStart, MIN_BAR_WIDTH);
	const isMilestone = lane.kind === "milestone";

	return (
		<g data-critical={lane.critical}>
			{/* Full-row background — visually marks the current selection.
			    Selection itself is handled by the matching LaneLabel button
			    on the left so the click target stays keyboard-accessible. */}
			<rect
				x={0}
				y={top}
				width={width}
				height={LANE_HEIGHT}
				className={cn("fill-transparent", isSelected && "fill-accent/40")}
			/>
			{/* Transparent button overlay covering the rest of the row so
			    clicking on the bar area (or empty space to its right) also
			    selects. Hidden from keyboard nav and a11y tree — the label
			    button on the left is the canonical control. */}
			<foreignObject x={0} y={top} width={width} height={LANE_HEIGHT}>
				<button
					type="button"
					tabIndex={-1}
					aria-hidden="true"
					onClick={() => onSelect(lane.taskId)}
					className="block size-full cursor-pointer bg-transparent"
				/>
			</foreignObject>
			{isMilestone ? (
				<g
					transform={`translate(${xStart}, ${top + LANE_HEIGHT / 2})`}
					className="pointer-events-none"
				>
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
						"pointer-events-none",
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

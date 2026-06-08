import {
	CircleDotIcon,
	FoldVerticalIcon,
	LayoutGridIcon,
	PinIcon,
	PlusIcon,
	Settings2Icon,
	UnfoldVerticalIcon,
} from "lucide-react";
import {
	CANVAS_SHORTCUTS,
	KeyboardShortcutsHelp,
} from "#/components/pert/keyboard-shortcuts-help";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Separator } from "#/components/ui/separator";
import {
	type CanvasPrefs,
	EDGE_STYLES,
	type EdgeStyle,
	type LayoutSpacing,
} from "#/lib/pert/canvas-prefs";
import { CanvasLegend } from "./canvas-legend";

export type CanvasAddToolbarProps = {
	onAddTask: () => void;
	onAddMilestone: () => void;
};

// Tooltip suffix that exposes the keyboard shortcut next to each button so
// users discover them without opening the help popover. The popover still
// ships the full cheat-sheet for the bindings that aren't on a button (Tab,
// arrows, etc.). Groups aren't created here — they come from the work plan /
// WBS hierarchy — so there's no "Group" button on the board.
export function CanvasAddToolbar({
	onAddTask,
	onAddMilestone,
}: CanvasAddToolbarProps) {
	return (
		<div
			data-testid="canvas-toolbar"
			className="flex flex-wrap items-center justify-center gap-1 rounded-lg border bg-background/95 px-1.5 py-1 shadow-sm backdrop-blur"
		>
			<Button
				size="sm"
				variant="ghost"
				className="h-8 gap-1.5 text-xs"
				onClick={onAddTask}
				data-testid="toolbar-add-task"
				title="Add a task (n)"
			>
				<PlusIcon className="size-3.5" />
				Task
			</Button>
			<Button
				size="sm"
				variant="ghost"
				className="h-8 gap-1.5 text-xs"
				onClick={onAddMilestone}
				data-testid="toolbar-add-milestone"
				title="Add a milestone (m)"
			>
				<CircleDotIcon className="size-3.5" />
				Milestone
			</Button>
		</div>
	);
}

export type CanvasViewToolbarProps = {
	prefs: CanvasPrefs;
	onSetEdgeStyle: (style: EdgeStyle) => void;
	onSetSpacing: (spacing: LayoutSpacing) => void;
	onRelayout: () => void;
	onToggleContinuous: () => void;
	// Collapse / expand every group at once. Hidden when the project has no
	// groups (callers pass undefined then).
	onCollapseAll?: () => void;
	onExpandAll?: () => void;
	// Set the grouping depth cap. Hidden when the project has no groups
	// (callers pass undefined then). The current cap is read from `prefs`.
	onSetGroupingLevel?: (level: number) => void;
};

// Grouping depth options. The numeric cap is a WBS level (1-based);
// `Number.POSITIVE_INFINITY` = all levels, `0` = grouping off.
const GROUPING_OPTIONS: ReadonlyArray<{
	value: string;
	label: string;
	description: string;
}> = [
	{ value: "off", label: "Off", description: "No group boxes — flat graph." },
	{
		value: "1",
		label: "Level 1 only",
		description: "Only top-level groups draw a box.",
	},
	{
		value: "2",
		label: "Up to level 2",
		description: "Boxes for levels 1–2; deeper groups fold into their parent.",
	},
	{
		value: "3",
		label: "Up to level 3",
		description: "Boxes for levels 1–3; deeper groups fold into their parent.",
	},
	{
		value: "all",
		label: "All levels",
		description: "Every group nesting level draws a box.",
	},
];

function groupingLevelToValue(level: number): string {
	if (level <= 0) return "off";
	if (!Number.isFinite(level)) return "all";
	if (level >= 1 && level <= 3) return String(level);
	return "all";
}

function groupingValueToLevel(value: string): number {
	if (value === "off") return 0;
	if (value === "all") return Number.POSITIVE_INFINITY;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export function CanvasViewToolbar({
	prefs,
	onSetEdgeStyle,
	onSetSpacing,
	onRelayout,
	onToggleContinuous,
	onCollapseAll,
	onExpandAll,
	onSetGroupingLevel,
}: CanvasViewToolbarProps) {
	return (
		<div
			data-testid="canvas-view-toolbar"
			className="flex flex-col items-stretch gap-1 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur"
		>
			<Button
				size="sm"
				variant="ghost"
				className="h-8 gap-1.5 text-xs"
				onClick={onRelayout}
				data-testid="toolbar-relayout"
				title="Re-layout the graph (overwrites every node position)"
			>
				<LayoutGridIcon className="size-3.5" />
				Re-layout
			</Button>
			<Button
				size="sm"
				variant={prefs.continuousLayout ? "secondary" : "ghost"}
				className="h-8 gap-1.5 text-xs"
				onClick={onToggleContinuous}
				data-testid="toolbar-continuous-layout"
				aria-pressed={prefs.continuousLayout}
				title={
					prefs.continuousLayout
						? "Auto-layout is ON. Selected node visually stays put as the rest reflows."
						: "Turn on auto-layout — every change reflows the graph; the selected node visually stays put."
				}
			>
				<PinIcon
					className={
						prefs.continuousLayout ? "size-3.5 text-primary" : "size-3.5"
					}
				/>
				Auto-layout
			</Button>
			{onCollapseAll && (
				<Button
					size="sm"
					variant="ghost"
					className="h-8 gap-1.5 text-xs"
					onClick={onCollapseAll}
					data-testid="toolbar-collapse-all"
					title="Collapse every group to its summary card"
				>
					<FoldVerticalIcon className="size-3.5" />
					Collapse all
				</Button>
			)}
			{onExpandAll && (
				<Button
					size="sm"
					variant="ghost"
					className="h-8 gap-1.5 text-xs"
					onClick={onExpandAll}
					data-testid="toolbar-expand-all"
					title="Expand every group"
				>
					<UnfoldVerticalIcon className="size-3.5" />
					Expand all
				</Button>
			)}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						variant="ghost"
						className="h-8 gap-1.5 text-xs"
						data-testid="toolbar-display"
						title="Edge style + spacing"
					>
						<Settings2Icon className="size-3.5" />
						Display
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" side="right" className="min-w-52">
					<DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
						Edge style
					</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={prefs.edgeStyle}
						onValueChange={(v) => onSetEdgeStyle(v as EdgeStyle)}
					>
						{EDGE_STYLES.map((style) => (
							<DropdownMenuRadioItem
								key={style.value}
								value={style.value}
								data-testid={`toolbar-edge-${style.value}`}
								title={style.description}
							>
								{style.label}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
						Graph tightness
					</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={prefs.spacing}
						onValueChange={(v) => onSetSpacing(v as LayoutSpacing)}
					>
						<DropdownMenuRadioItem
							value="compact"
							data-testid="toolbar-spacing-compact"
						>
							Compact
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem
							value="comfortable"
							data-testid="toolbar-spacing-comfortable"
						>
							Comfortable
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem
							value="spacious"
							data-testid="toolbar-spacing-spacious"
						>
							Spacious
						</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
					{onSetGroupingLevel && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Grouping
							</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={groupingLevelToValue(prefs.groupingMaxLevel)}
								onValueChange={(v) =>
									onSetGroupingLevel(groupingValueToLevel(v))
								}
							>
								{GROUPING_OPTIONS.map((opt) => (
									<DropdownMenuRadioItem
										key={opt.value}
										value={opt.value}
										data-testid={`toolbar-grouping-${opt.value}`}
										title={opt.description}
									>
										{opt.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={onRelayout}
						data-testid="toolbar-display-relayout"
					>
						<LayoutGridIcon className="size-3.5" />
						Re-layout now
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Separator orientation="horizontal" className="my-0.5" />
			<KeyboardShortcutsHelp
				groups={CANVAS_SHORTCUTS}
				testId="canvas-keyboard-help"
				tooltip="Canvas keyboard shortcuts"
				side="right"
				align="start"
			/>
			<CanvasLegend />
		</div>
	);
}

import {
	CircleDotIcon,
	FolderPlusIcon,
	LayoutGridIcon,
	PinIcon,
	PlusIcon,
	Settings2Icon,
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

export type CanvasAddToolbarProps = {
	onAddTask: () => void;
	onAddMilestone: () => void;
	onAddContainer: () => void;
};

// Tooltip suffix that exposes the keyboard shortcut next to each button so
// users discover them without opening the help popover. The popover still
// ships the full cheat-sheet for the bindings that aren't on a button (Tab,
// arrows, etc.).
export function CanvasAddToolbar({
	onAddTask,
	onAddMilestone,
	onAddContainer,
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
			<Button
				size="sm"
				variant="ghost"
				className="h-8 gap-1.5 text-xs"
				onClick={onAddContainer}
				data-testid="toolbar-add-container"
				title="Add a container (c)"
			>
				<FolderPlusIcon className="size-3.5" />
				Container
			</Button>
			<Separator orientation="vertical" className="mx-1 h-5" />
			<KeyboardShortcutsHelp
				groups={CANVAS_SHORTCUTS}
				testId="canvas-keyboard-help"
				tooltip="Canvas keyboard shortcuts"
			/>
		</div>
	);
}

export type CanvasViewToolbarProps = {
	prefs: CanvasPrefs;
	onSetEdgeStyle: (style: EdgeStyle) => void;
	onSetSpacing: (spacing: LayoutSpacing) => void;
	onRelayout: () => void;
	onToggleContinuous: () => void;
};

export function CanvasViewToolbar({
	prefs,
	onSetEdgeStyle,
	onSetSpacing,
	onRelayout,
	onToggleContinuous,
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
		</div>
	);
}

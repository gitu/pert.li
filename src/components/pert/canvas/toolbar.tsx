import {
	CircleDotIcon,
	FolderPlusIcon,
	LayoutGridIcon,
	PlusIcon,
	Settings2Icon,
} from "lucide-react";
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

export type CanvasToolbarProps = {
	onAddTask: () => void;
	onAddMilestone: () => void;
	onAddContainer: () => void;
	prefs: CanvasPrefs;
	onSetEdgeStyle: (style: EdgeStyle) => void;
	onSetSpacing: (spacing: LayoutSpacing) => void;
	onRelayout: () => void;
};

export function CanvasToolbar({
	onAddTask,
	onAddMilestone,
	onAddContainer,
	prefs,
	onSetEdgeStyle,
	onSetSpacing,
	onRelayout,
}: CanvasToolbarProps) {
	return (
		<div
			data-testid="canvas-toolbar"
			// `flex-wrap` lets the toolbar spill onto a second row on narrow
			// viewports instead of overflowing horizontally and clipping the
			// last few buttons. `justify-center` keeps the wrapped row aligned
			// under the first one. Separators are intentionally NOT hidden when
			// wrapped — they still mark the grouping even when stacked.
			className="flex flex-wrap items-center justify-center gap-1 rounded-lg border bg-background/95 px-1.5 py-1 shadow-sm backdrop-blur"
		>
			<Button
				size="sm"
				variant="ghost"
				className="h-8 gap-1.5 text-xs"
				onClick={onAddTask}
				data-testid="toolbar-add-task"
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
			>
				<FolderPlusIcon className="size-3.5" />
				Container
			</Button>
			<Separator orientation="vertical" className="mx-1 h-5" />
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
				<DropdownMenuContent align="end" className="min-w-52">
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

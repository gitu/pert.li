import {
	AlertOctagonIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	PaletteIcon,
	ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";

type LegendRow = {
	swatch: ReactNode;
	label: string;
	hint: string;
};

// The canvas encodes task state through colour + icon (see task-node.tsx).
// Without a key the meanings are guessable at best; this popover spells them
// out using the *same* icons and colour tokens the node renders, so the legend
// can never silently drift from the canvas. When you change a node colour or
// icon, update the matching row here.
const LEGEND_ROWS: LegendRow[] = [
	{
		swatch: <ZapIcon className="size-4 text-destructive" />,
		label: "Critical path",
		hint: "Zero slack — any delay here slips the whole project.",
	},
	{
		swatch: (
			<CircleDotIcon className="size-4 text-amber-600 dark:text-amber-400" />
		),
		label: "In progress",
		hint: "Started but not finished. Shows a progress bar.",
	},
	{
		swatch: (
			<CheckCircle2Icon className="size-4 text-sky-600 dark:text-sky-400" />
		),
		label: "Completed",
		hint: "Marked done from the Track tab.",
	},
	{
		swatch: <CircleDotIcon className="size-4 text-muted-foreground" />,
		label: "Milestone",
		hint: "A zero-duration checkpoint, not a unit of work.",
	},
	{
		swatch: <AlertOctagonIcon className="size-4 text-destructive" />,
		label: "Cycle / blocked",
		hint: "Part of a dependency loop — scheduling can't run until it's broken.",
	},
	{
		swatch: (
			<span className="size-4 rounded-sm border-2 border-destructive ring-1 ring-destructive/40" />
		),
		label: "Likely critical",
		hint: "Monte-Carlo runs put this on the critical path in most trials.",
	},
];

// Small "what do these colours mean?" key, mirroring KeyboardShortcutsHelp's
// popover shape so the canvas toolbar reads consistently. Additive only — it
// reads nothing and changes nothing.
export function CanvasLegend() {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					size="sm"
					variant="ghost"
					className="h-8 gap-1.5 text-xs"
					data-testid="canvas-legend"
					title="What the colours mean"
					aria-label="Canvas legend"
				>
					<PaletteIcon className="size-3.5" />
					Legend
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="right"
				className="w-72 p-0"
				data-testid="canvas-legend-content"
			>
				<div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					What the colours mean
				</div>
				<ul className="divide-y divide-border">
					{LEGEND_ROWS.map((row) => (
						<li key={row.label} className="flex items-start gap-2.5 px-3 py-2">
							<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
								{row.swatch}
							</span>
							<span className="min-w-0">
								<span className="block text-xs font-medium text-foreground">
									{row.label}
								</span>
								<span className="block text-[11px] leading-snug text-muted-foreground">
									{row.hint}
								</span>
							</span>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}

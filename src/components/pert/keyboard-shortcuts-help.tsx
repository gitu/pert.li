import { KeyboardIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";

export type ShortcutRow = {
	keys: string[];
	label: string;
};

export type ShortcutGroup = {
	heading: string;
	rows: ShortcutRow[];
};

// Reusable keyboard cheat-sheet. Lives next to the canvas and table toolbars
// so power users can keep the full set of bindings in front of them without
// digging into docs — the goal is to make shortcuts discoverable from the UI
// itself. Each surface (canvas, table) passes the groups that apply to it,
// so the popover always reflects exactly what works on that screen.
export function KeyboardShortcutsHelp({
	groups,
	testId = "keyboard-help",
	tooltip = "Keyboard shortcuts (?)",
	align = "end",
	side,
}: {
	groups: ShortcutGroup[];
	testId?: string;
	tooltip?: string;
	// Popover placement. Defaults suit the horizontal table toolbar; the canvas
	// view toolbar is a vertical bar on the left, so it passes side="right" /
	// align="start" to mirror the adjacent legend popover.
	align?: "start" | "center" | "end";
	side?: "top" | "right" | "bottom" | "left";
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					size="sm"
					variant="ghost"
					className="h-8 gap-1.5 text-xs"
					data-testid={testId}
					title={tooltip}
					aria-label={tooltip}
				>
					<KeyboardIcon className="size-3.5" />
					Keys
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align={align}
				side={side}
				className="w-80 p-0"
				data-testid={`${testId}-content`}
			>
				<div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Keyboard shortcuts
				</div>
				<div className="max-h-[60vh] divide-y divide-border overflow-y-auto">
					{groups.map((group) => (
						<section key={group.heading} className="px-3 py-2">
							<h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
								{group.heading}
							</h4>
							<ul className="space-y-1">
								{group.rows.map((row) => (
									<li
										key={`${group.heading}-${row.label}-${row.keys.join("+")}`}
										className="flex items-baseline justify-between gap-3 text-xs"
									>
										<span className="text-foreground/90">{row.label}</span>
										<span className="flex shrink-0 items-center gap-1">
											{row.keys.map((k, i) => {
												// Keys can repeat (e.g. ⌘ alone, then ⌘+L) so the
												// index is part of the key. The Biome rule fires
												// because keys aren't stable across reorders, but
												// these arrays never reorder at runtime — they're
												// the constants exported below.
												const slotKey = `${row.label}@${i}`;
												return (
													<span
														key={slotKey}
														className="flex items-center gap-1"
													>
														{i > 0 && (
															<span className="text-[10px] text-muted-foreground">
																{k === "or" ? "or" : "+"}
															</span>
														)}
														{k !== "or" && (
															<kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground shadow-sm">
																{k}
															</kbd>
														)}
													</span>
												);
											})}
										</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
				<div className="border-t bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
					Press{" "}
					<kbd className="rounded border bg-background px-1 font-mono">?</kbd>{" "}
					on this view to reopen this help.
				</div>
			</PopoverContent>
		</Popover>
	);
}

// Canonical canvas shortcut definitions. Exported so the canvas keydown
// handler and the popover stay in sync — adding a binding here forces both
// sites to acknowledge it.
export const CANVAS_SHORTCUTS: ShortcutGroup[] = [
	{
		heading: "Add",
		rows: [
			{ label: "Add task at viewport centre", keys: ["n"] },
			{ label: "Add milestone at viewport centre", keys: ["m"] },
			{ label: "Add group at viewport centre", keys: ["g"] },
			{
				label: "Spawn downstream task (linked) from selection",
				keys: ["Tab"],
			},
			{
				label: "Spawn sibling task (shares predecessors)",
				keys: ["Shift", "Tab"],
			},
			{
				label: "Add linked predecessor / successor",
				keys: ["⌘/Ctrl", "←", "or", "→"],
			},
		],
	},
	{
		heading: "Navigate",
		rows: [
			{ label: "Walk to predecessor / successor", keys: ["←", "or", "→"] },
			{ label: "Walk to sibling above / below", keys: ["↑", "or", "↓"] },
			{ label: "Clear selection", keys: ["Esc"] },
		],
	},
	{
		heading: "Edit",
		rows: [
			{ label: "Rename / edit selected node", keys: ["Enter"] },
			{ label: "Delete selected node or edge", keys: ["Backspace"] },
		],
	},
];

export const TABLE_SHORTCUTS: ShortcutGroup[] = [
	{
		heading: "Add",
		rows: [
			{ label: "Focus the quick-add row", keys: ["n"] },
			{ label: "Focus the quick-add row", keys: ["⌘/Ctrl", "I"] },
			{ label: "Commit quick-add as task", keys: ["Enter"] },
			{ label: "Commit quick-add as milestone", keys: ["Shift", "Enter"] },
			{ label: "Insert a task below the selected row", keys: ["o"] },
			{ label: "Insert a task above the selected row", keys: ["Shift", "O"] },
		],
	},
	{
		heading: "Navigate",
		rows: [
			{ label: "Move selection up / down", keys: ["↑", "or", "↓"] },
			{ label: "Rename selected row", keys: ["Enter"] },
			{ label: "Clear selection", keys: ["Esc"] },
		],
	},
	{
		heading: "Group",
		rows: [
			{
				label: "Join the previous row's group",
				keys: ["Tab"],
			},
			{
				label: "Move out to the parent group",
				keys: ["Shift", "Tab"],
			},
		],
	},
];

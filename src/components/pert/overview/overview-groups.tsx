import { ChevronRightIcon, LayersIcon } from "lucide-react";
import { useMemo } from "react";
import { Progress } from "#/components/ui/progress";
import { computeNumbering } from "#/lib/pert/numbering";
import { type GroupRollup, rollupGroup } from "#/lib/pert/projection";
import type { Schedule } from "#/lib/pert/schedule";
import type { PertDoc } from "#/lib/pert/types";

type GroupRow = {
	id: string;
	name: string;
	number: string;
	rollup: GroupRollup;
};

// Project-Overview "Groups" section: one row per group, sorted by WBS number,
// each showing its rolled-up task count, expected duration, and % complete.
// Rows click through to select the group (the container decides where that
// lands the user). Pure over `doc` + the already-computed `schedule` (the
// Overview view computes it once and shares it with the project rollups, so the
// CPM scheduler isn't run twice); selection is handed down as `onSelect`.
export function OverviewGroups({
	doc,
	schedule,
	onSelect,
}: {
	doc: PertDoc;
	schedule: Schedule | null;
	onSelect: (groupId: string) => void;
}) {
	const rows = useMemo<GroupRow[]>(() => {
		const numbering = computeNumbering(doc);
		return Object.values(doc.groupsById)
			.map((g) => ({
				id: g.id,
				name: g.name || "Untitled",
				number: numbering.groups[g.id] ?? "?",
				rollup: rollupGroup(doc, schedule, g.id),
			}))
			.sort((a, b) =>
				a.number.localeCompare(b.number, undefined, { numeric: true }),
			);
	}, [doc, schedule]);

	return (
		<section data-testid="overview-groups">
			<h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
				<LayersIcon className="size-4 text-muted-foreground" />
				Groups
				<span className="text-xs font-normal text-muted-foreground">
					({rows.length})
				</span>
			</h2>
			{rows.length === 0 ? (
				<p className="rounded-md border bg-card/40 p-3 text-xs text-muted-foreground">
					No groups yet. Group tasks from a task's Plan tab or by dragging cards
					together on the Network canvas.
				</p>
			) : (
				<ul className="divide-y rounded-md border bg-card/40">
					{rows.map((row) => (
						<li key={row.id}>
							<button
								type="button"
								onClick={() => onSelect(row.id)}
								data-testid={`overview-group-${row.id}`}
								className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-brand/5"
							>
								<span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
									{row.number}
								</span>
								<span className="min-w-0 flex-1 truncate text-sm font-medium">
									{row.name}
								</span>
								<span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
									{row.rollup.descendantCount}{" "}
									{row.rollup.descendantCount === 1 ? "task" : "tasks"}
								</span>
								<span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
									{fmtDays(row.rollup.expected)}
								</span>
								<span className="flex w-24 shrink-0 items-center gap-1.5">
									<Progress value={row.rollup.progress} className="h-1.5" />
									<span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
										{Math.round(row.rollup.progress)}%
									</span>
								</span>
								<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-brand" />
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

// Compact day formatter: drop the decimal for whole numbers, one place
// otherwise (matches the inspector's rollup figures).
function fmtDays(n: number): string {
	const r = Math.round(n * 10) / 10;
	return `${Number.isInteger(r) ? r : r.toFixed(1)} d`;
}

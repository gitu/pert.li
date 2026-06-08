import { CheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { SheetFooter } from "#/components/ui/sheet";
import { historicCapacityPerDay } from "#/lib/pert/schedule";
import type {
	AllocationMode,
	PertDoc,
	ProjectCalendar,
	TeamCapacity,
} from "#/lib/pert/types";

// The actual form fields. Lives in its own component so the parent Sheet can
// mount/unmount it on open — that gives us "re-seed from props" semantics for
// free (initial state is captured at mount), without needing a useEffect.

const WEEKDAY_LABEL: Record<number, string> = {
	1: "Mon",
	2: "Tue",
	3: "Wed",
	4: "Thu",
	5: "Fri",
	6: "Sat",
	7: "Sun",
};

const DEFAULT_TEAM: TeamCapacity = { peopleCount: 1, availabilityPct: 100 };

export function ProjectCalendarForm({
	initial,
	doc,
	onCancel,
	onSave,
}: {
	initial: ProjectCalendar;
	// Read-only handle on the active doc so the form can show a live readout
	// of total person-days across all tasks. The form NEVER mutates the doc
	// directly — it only emits the calendar via onSave.
	doc: PertDoc;
	onCancel: () => void;
	onSave: (next: {
		startDate: string;
		workingDays: number[];
		allocationMode: AllocationMode;
		team: TeamCapacity;
	}) => void;
}) {
	const [startDate, setStartDate] = useState(initial.startDate);
	const [workingDays, setWorkingDays] = useState<number[]>(initial.workingDays);
	const [mode, setMode] = useState<AllocationMode>(
		initial.allocationMode ?? "calendar",
	);
	const [team, setTeam] = useState<TeamCapacity>(initial.team ?? DEFAULT_TEAM);

	const toggleDay = (day: number) => {
		setWorkingDays((prev) =>
			prev.includes(day)
				? prev.filter((d) => d !== day)
				: [...prev, day].sort((a, b) => a - b),
		);
	};

	// Has the user edited anything since the form was seeded? Drives the
	// "Unsaved changes" / "All changes saved" marker in the footer. The form is
	// remounted (key bump) after a successful save, so this re-seeds to clean.
	const dirty = formDiffers(initial, { startDate, workingDays, mode, team });

	// Live readout. Total work = sum of leaf tasks' expected PERT durations
	// (in days). Daily capacity = peopleCount × availability% (or observed
	// historic PD/day when "Use historic" is on and there's signal). Forecast
	// days at that capacity is just total / capacity — the absolute floor,
	// independent of dependencies.
	const historic = useMemo(() => historicCapacityPerDay(doc), [doc]);
	const totals = useMemo(() => {
		let totalPd = 0;
		for (const task of Object.values(doc.tasksById)) {
			if (task.kind !== "task" || !task.estimate) continue;
			const e = task.estimate;
			const factor = e.unit === "hour" ? 1 / 24 : e.unit === "week" ? 7 : 1;
			const expectedDays =
				((e.optimistic + 4 * e.mostLikely + e.pessimistic) / 6) * factor;
			totalPd += expectedDays;
		}
		const configured = team.peopleCount * (team.availabilityPct / 100);
		const capacity =
			team.useHistoric && historic ? historic.perDay : configured;
		const floorDays =
			capacity > 0 ? totalPd / capacity : Number.POSITIVE_INFINITY;
		return { totalPd, capacity, floorDays, configured };
	}, [
		doc.tasksById,
		team.peopleCount,
		team.availabilityPct,
		team.useHistoric,
		historic,
	]);

	return (
		<>
			<div className="space-y-5 p-4">
				<div className="space-y-1.5">
					<Label htmlFor="calendar-start">Start date</Label>
					<Input
						id="calendar-start"
						data-testid="calendar-start-input"
						type="date"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
					/>
				</div>
				<div className="space-y-2">
					<Label>Working days</Label>
					<div className="flex flex-wrap gap-1.5">
						{[1, 2, 3, 4, 5, 6, 7].map((day) => {
							const active = workingDays.includes(day);
							return (
								<button
									key={day}
									type="button"
									onClick={() => toggleDay(day)}
									aria-pressed={active}
									data-testid={`calendar-day-${day}`}
									className={
										active
											? "rounded-md border bg-foreground px-2.5 py-1 text-xs font-medium text-background"
											: "rounded-md border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
									}
								>
									{WEEKDAY_LABEL[day]}
								</button>
							);
						})}
					</div>
					<p className="text-xs text-muted-foreground">
						Days unchecked are treated as non-working — duration math skips
						them.
					</p>
				</div>

				<div className="space-y-2">
					<Label>Scheduling mode</Label>
					<div className="inline-flex w-full rounded-md border bg-background p-0.5">
						<ModeButton
							active={mode === "calendar"}
							onClick={() => setMode("calendar")}
							label="Calendar days"
							testid="mode-calendar"
						/>
						<ModeButton
							active={mode === "team"}
							onClick={() => setMode("team")}
							label="Team capacity"
							testid="mode-team"
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						{mode === "team"
							? "Worst case: capacity is split equally among every task currently open. Stretches durations + critical path."
							: "Treats each estimate as a calendar-day cost. Assumes whoever is on the task can finish it without contention."}
					</p>
				</div>

				{mode === "team" && (
					<div className="space-y-3 rounded-md border bg-muted/20 p-3">
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="calendar-people">People</Label>
								<Input
									id="calendar-people"
									data-testid="calendar-people-input"
									type="number"
									min={0}
									step={1}
									value={team.peopleCount}
									onChange={(e) =>
										setTeam((prev) => ({
											...prev,
											peopleCount: Math.max(
												0,
												Math.round(Number.parseFloat(e.target.value) || 0),
											),
										}))
									}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="calendar-availability">Availability (%)</Label>
								<Input
									id="calendar-availability"
									data-testid="calendar-availability-input"
									type="number"
									min={0}
									max={100}
									step={5}
									value={team.availabilityPct}
									onChange={(e) =>
										setTeam((prev) => ({
											...prev,
											availabilityPct: Math.max(
												0,
												Math.min(100, Number.parseFloat(e.target.value) || 0),
											),
										}))
									}
								/>
							</div>
						</div>
						<dl
							className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs"
							data-testid="calendar-team-readout"
						>
							<dt className="text-muted-foreground">Total work</dt>
							<dd className="tabular-nums">{formatDays(totals.totalPd)} PD</dd>
							<dt className="text-muted-foreground">Daily capacity</dt>
							<dd className="tabular-nums">
								{formatDays(totals.capacity)} PD/day
								{team.useHistoric && historic && (
									<span className="ml-1 text-muted-foreground">(historic)</span>
								)}
							</dd>
							<dt className="text-muted-foreground">Floor finish</dt>
							<dd className="tabular-nums">
								{Number.isFinite(totals.floorDays)
									? `${formatDays(totals.floorDays)} working days`
									: "—"}
							</dd>
						</dl>
						<p className="text-xs text-muted-foreground">
							The CPM may push the finish further still if dependencies force
							serialisation.
						</p>
						<HistoricBlock
							historic={historic}
							useHistoric={Boolean(team.useHistoric)}
							onToggle={(next) =>
								setTeam((prev) => ({ ...prev, useHistoric: next }))
							}
						/>
					</div>
				)}
			</div>
			<SheetFooter>
				{dirty ? (
					<span
						className="mr-auto inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500"
						data-testid="calendar-dirty"
					>
						<span className="size-1.5 rounded-full bg-amber-500" />
						Unsaved changes
					</span>
				) : (
					<span
						className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"
						data-testid="calendar-clean"
					>
						<CheckIcon className="size-3.5" />
						All changes saved
					</span>
				)}
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					data-testid="calendar-save"
					disabled={!startDate}
					onClick={() =>
						onSave({
							startDate,
							workingDays,
							allocationMode: mode,
							team,
						})
					}
				>
					Save
				</Button>
			</SheetFooter>
		</>
	);
}

function HistoricBlock({
	historic,
	useHistoric,
	onToggle,
}: {
	historic: ReturnType<typeof historicCapacityPerDay>;
	useHistoric: boolean;
	onToggle: (next: boolean) => void;
}) {
	if (!historic) {
		return (
			<div
				data-testid="calendar-historic-empty"
				className="rounded-md border border-dashed bg-background/40 p-2 text-xs text-muted-foreground"
			>
				No completed tasks with start &amp; finish dates yet — mark some tasks
				done to derive an observed velocity.
			</div>
		);
	}
	return (
		<div
			data-testid="calendar-historic-block"
			className="space-y-1.5 rounded-md border bg-background/40 p-2 text-xs"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium">Historic velocity</span>
				<label className="inline-flex items-center gap-1.5 text-xs">
					<input
						type="checkbox"
						data-testid="calendar-use-historic"
						checked={useHistoric}
						onChange={(e) => onToggle(e.target.checked)}
						className="size-3.5 rounded border"
					/>
					Use historic
				</label>
			</div>
			<dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
				<dt>Delivered</dt>
				<dd className="tabular-nums text-foreground">
					{formatDays(historic.deliveredPd)} PD across {historic.sampleCount}{" "}
					task{historic.sampleCount === 1 ? "" : "s"}
				</dd>
				<dt>Elapsed</dt>
				<dd className="tabular-nums text-foreground">
					{formatDays(historic.elapsedWorkingDays)} working days
				</dd>
				<dt>Observed</dt>
				<dd className="tabular-nums text-foreground">
					{formatDays(historic.perDay)} PD/day
				</dd>
			</dl>
		</div>
	);
}

function ModeButton({
	active,
	onClick,
	label,
	testid,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	testid: string;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={onClick}
			aria-pressed={active}
			className={
				active
					? "flex-1 rounded bg-foreground px-2 py-1 text-xs font-medium text-background"
					: "flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
			}
		>
			{label}
		</button>
	);
}

function formatDays(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	if (n === 0) return "0";
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

// True when the live form state diverges from the calendar it was seeded with.
// Mirrors the seeding in the component (mode/team fall back to defaults) so an
// untouched form reads as clean.
function formDiffers(
	initial: ProjectCalendar,
	current: {
		startDate: string;
		workingDays: number[];
		mode: AllocationMode;
		team: TeamCapacity;
	},
): boolean {
	if (initial.startDate !== current.startDate) return true;
	if (!sameDays(initial.workingDays, current.workingDays)) return true;
	if ((initial.allocationMode ?? "calendar") !== current.mode) return true;
	const seedTeam = initial.team ?? DEFAULT_TEAM;
	if (seedTeam.peopleCount !== current.team.peopleCount) return true;
	if (seedTeam.availabilityPct !== current.team.availabilityPct) return true;
	if (Boolean(seedTeam.useHistoric) !== Boolean(current.team.useHistoric)) {
		return true;
	}
	return false;
}

function sameDays(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	const sa = [...a].sort((x, y) => x - y);
	const sb = [...b].sort((x, y) => x - y);
	return sa.every((v, i) => v === sb[i]);
}

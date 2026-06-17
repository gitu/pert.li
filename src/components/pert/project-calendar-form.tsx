import { CheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { SheetFooter } from "#/components/ui/sheet";
import {
	MIN_STAFFING_LEVEL_DAYS,
	type ResolvedStaffing,
} from "#/lib/pert/resolve-scheduling";
import { historicCapacityPerDay } from "#/lib/pert/schedule";
import type {
	AllocationMode,
	ParallelStaffing,
	PertDoc,
	ProjectCalendar,
	ScheduleBasis,
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

// The combined payload the form emits: calendar/team fields plus the scheduling
// settings (basis + parallel staffing). The parent fans these into applyCalendar
// + applyScheduling.
export type CalendarSchedulingFormResult = {
	startDate: string;
	workingDays: number[];
	allocationMode: AllocationMode;
	team: TeamCapacity;
	basis: ScheduleBasis;
	parallelStaffing: ParallelStaffing;
};

export function ProjectCalendarForm({
	initial,
	schedulingInitial,
	doc,
	onCancel,
	onSave,
}: {
	initial: ProjectCalendar;
	// Resolved (clamped, total) scheduling settings to seed the basis + staffing
	// controls. Parent derives it via resolveScheduling(doc).
	schedulingInitial: { basis: ScheduleBasis; staffing: ResolvedStaffing };
	// Read-only handle on the active doc so the form can show a live readout
	// of total person-days across all tasks. The form NEVER mutates the doc
	// directly — it only emits the calendar via onSave.
	doc: PertDoc;
	onCancel: () => void;
	onSave: (next: CalendarSchedulingFormResult) => void;
}) {
	const [startDate, setStartDate] = useState(initial.startDate);
	const [workingDays, setWorkingDays] = useState<number[]>(initial.workingDays);
	const [mode, setMode] = useState<AllocationMode>(
		initial.allocationMode ?? "calendar",
	);
	const [team, setTeam] = useState<TeamCapacity>(initial.team ?? DEFAULT_TEAM);
	const [basis, setBasis] = useState<ScheduleBasis>(schedulingInitial.basis);
	const [staffing, setStaffing] = useState<ResolvedStaffing>(
		schedulingInitial.staffing,
	);

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
	const dirty =
		formDiffers(initial, { startDate, workingDays, mode, team }) ||
		schedulingDiffers(schedulingInitial, { basis, staffing });

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
						<div className="space-y-1.5">
							<Label className="text-xs">Estimates represent</Label>
							<div
								className="flex items-center gap-1 rounded-md border p-0.5"
								data-testid="calendar-estimate-basis"
							>
								<ModeButton
									active={(team.estimateBasis ?? "effort") === "effort"}
									onClick={() =>
										setTeam((prev) => ({ ...prev, estimateBasis: "effort" }))
									}
									label="Effort (person-days)"
									testid="basis-effort"
								/>
								<ModeButton
									active={team.estimateBasis === "duration"}
									onClick={() =>
										setTeam((prev) => ({ ...prev, estimateBasis: "duration" }))
									}
									label="Duration (calendar days)"
									testid="basis-duration"
								/>
							</div>
							<p className="text-xs text-muted-foreground">
								{team.estimateBasis === "duration"
									? "Each estimate is the calendar time one assignee needs. A task alone in its window keeps that duration; only tasks competing for more people than the team has get stretched."
									: "Each estimate is person-days of work. The team's daily capacity is split across every open task, so a task with too few people takes proportionally longer — even on its own."}
							</p>
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

				<div className="space-y-2">
					<Label>Schedule basis</Label>
					<div className="inline-flex w-full rounded-md border bg-background p-0.5">
						<ModeButton
							active={basis === "expected"}
							onClick={() => setBasis("expected")}
							label="Expected (PERT)"
							testid="schedule-basis-expected"
						/>
						<ModeButton
							active={basis === "most-likely"}
							onClick={() => setBasis("most-likely")}
							label="Most likely"
							testid="schedule-basis-most-likely"
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						{basis === "most-likely"
							? "Lays out start/finish dates from each task's most-likely estimate. The duration shown on the canvas and lists stays the PERT expected value."
							: "Lays out start/finish dates from the PERT expected value (o + 4m + p) / 6 — the default."}
					</p>
				</div>

				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor="staffing-enabled">Parallel staffing</Label>
						<label className="inline-flex items-center gap-1.5 text-xs">
							<input
								id="staffing-enabled"
								type="checkbox"
								data-testid="staffing-enabled"
								// Reflect the actual stored state even in Team mode (where the
								// control is disabled and the note explains staffing is
								// inactive). Forcing it unchecked would hide config that still
								// persists and reactivates on switching back to Calendar-days.
								checked={staffing.enabled}
								disabled={mode === "team"}
								onChange={(e) =>
									setStaffing((p) => ({ ...p, enabled: e.target.checked }))
								}
								className="size-3.5 rounded border"
							/>
							Enabled
						</label>
					</div>
					{mode === "team" ? (
						<p
							className="text-xs text-muted-foreground"
							data-testid="staffing-team-note"
						>
							Parallel staffing applies in Calendar-days mode. Team capacity
							already models shared staffing.
						</p>
					) : (
						<div className="space-y-3">
							<p className="text-xs text-muted-foreground">
								An additional forecast that crashes big tasks by putting up to N
								equal people on them (linear speedup). It never changes the
								durations shown on the canvas or lists.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1.5">
									<Label htmlFor="staffing-level">Level (days)</Label>
									<Input
										id="staffing-level"
										data-testid="staffing-level-input"
										type="number"
										min={MIN_STAFFING_LEVEL_DAYS}
										step={0.5}
										value={staffing.levelDays}
										disabled={!staffing.enabled}
										onChange={(e) =>
											setStaffing((p) => ({
												...p,
												levelDays: Math.max(
													MIN_STAFFING_LEVEL_DAYS,
													Number.parseFloat(e.target.value) ||
														MIN_STAFFING_LEVEL_DAYS,
												),
											}))
										}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="staffing-max">Max people / task</Label>
									<Input
										id="staffing-max"
										data-testid="staffing-max-input"
										type="number"
										min={1}
										step={1}
										value={staffing.maxPerTask}
										disabled={!staffing.enabled}
										onChange={(e) =>
											setStaffing((p) => ({
												...p,
												maxPerTask: Math.max(
													1,
													Math.round(Number.parseFloat(e.target.value) || 1),
												),
											}))
										}
									/>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								One extra person per {formatDays(staffing.levelDays)} d of task
								size, up to {staffing.maxPerTask}.{" "}
								{staffing.maxPerTask <= 1
									? "At 1, staffing has no effect."
									: `e.g. a ${formatDays(
											staffing.levelDays * staffing.maxPerTask,
										)} d task → ${staffing.maxPerTask} people → ~${formatDays(
											staffing.levelDays,
										)} d.`}
							</p>
						</div>
					)}
				</div>
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
							basis,
							parallelStaffing: {
								enabled: staffing.enabled,
								levelDays: staffing.levelDays,
								maxPerTask: staffing.maxPerTask,
							},
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
	if (
		(seedTeam.estimateBasis ?? "effort") !==
		(current.team.estimateBasis ?? "effort")
	) {
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

// True when the basis/staffing controls diverge from their seeded (resolved)
// values. Both sides are already in resolved/total shape, so a flat compare.
function schedulingDiffers(
	seed: { basis: ScheduleBasis; staffing: ResolvedStaffing },
	current: { basis: ScheduleBasis; staffing: ResolvedStaffing },
): boolean {
	if (seed.basis !== current.basis) return true;
	if (seed.staffing.enabled !== current.staffing.enabled) return true;
	if (seed.staffing.levelDays !== current.staffing.levelDays) return true;
	if (seed.staffing.maxPerTask !== current.staffing.maxPerTask) return true;
	return false;
}

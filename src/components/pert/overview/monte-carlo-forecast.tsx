import { Loader2Icon, TrendingUpIcon, UsersIcon } from "lucide-react";
import { useMemo } from "react";
import type { MonteCarloResult } from "#/lib/pert/montecarlo";
import { computeSchedule } from "#/lib/pert/schedule";
import type { PertDoc } from "#/lib/pert/types";
import {
	FORECAST_TRIALS,
	useSchedulingForecast,
} from "#/lib/pert/use-scheduling-forecast";

// Read-only Monte Carlo finish-date forecast shown in the Overview's
// Calendar & scheduling section. The container runs the (fake-delayed)
// simulation hook; the View is pure so Storybook can drive each state.

const TOP_TASK_LIMIT = 5;

type ForecastStatus = "calculating" | "ready" | "empty" | "unavailable";

export function MonteCarloForecast({ doc }: { doc: PertDoc }) {
	const { result, calculating, empty } = useSchedulingForecast(doc, {
		seed: 1,
	});

	// A settled run with no result (a dependency cycle) is "unavailable", not an
	// endless spinner.
	const status: ForecastStatus = empty
		? "empty"
		: calculating
			? "calculating"
			: result
				? "ready"
				: "unavailable";

	return <MonteCarloForecastView status={status} result={result} doc={doc} />;
}

export function MonteCarloForecastView({
	status,
	result,
	doc,
}: {
	status: ForecastStatus;
	result: MonteCarloResult | null;
	doc: PertDoc;
}) {
	return (
		<div className="px-4 py-3" data-testid="monte-carlo-forecast">
			<div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
				<TrendingUpIcon className="size-4" />
				Finish-date forecast
				<span className="ml-1 text-xs font-normal text-muted-foreground">
					Monte Carlo
				</span>
			</div>

			{status === "empty" && (
				<p className="text-xs text-muted-foreground" data-testid="mc-empty">
					Add tasks with three-point estimates to see a probabilistic
					finish-date forecast.
				</p>
			)}

			{status === "unavailable" && (
				<p
					className="text-xs text-muted-foreground"
					data-testid="mc-unavailable"
				>
					Forecast unavailable — the dependencies form a cycle, so there's no
					schedule to simulate. Break the cycle to compute a finish date.
				</p>
			)}

			{status === "calculating" && (
				<div
					className="flex items-center gap-2 py-3 text-xs text-muted-foreground"
					data-testid="mc-calculating"
				>
					<Loader2Icon className="size-4 animate-spin" />
					Running {FORECAST_TRIALS.toLocaleString()} simulated trials…
				</div>
			)}

			{status === "ready" && result && (
				<ReadyForecast result={result} doc={doc} />
			)}
		</div>
	);
}

function ReadyForecast({
	result,
	doc,
}: {
	result: MonteCarloResult;
	doc: PertDoc;
}) {
	const finish = result.projectFinish;
	const staffed = result.projectFinishStaffed;
	const topTasks = Object.values(result.tasks)
		.filter((t) => t.criticality > 0)
		.sort((a, b) => b.criticality - a.criticality)
		.slice(0, TOP_TASK_LIMIT);

	// Deterministic "most-likely" finish — a single CPM pass on each task's
	// most-likely value, independent of the project's active basis. Gives the
	// "produce an output from the most likely case" reference point next to the
	// probabilistic forecast.
	const mostLikely = useMemo(() => {
		const r = computeSchedule(doc, { basis: "most-likely" });
		return r.ok ? r.schedule : null;
	}, [doc]);

	return (
		<div className="space-y-3" data-testid="mc-result">
			<dl className="grid grid-cols-2 gap-3">
				<Stat
					label="P50 finish"
					tooltip="Coin-flip date — half of simulated runs finished by here."
					days={finish.p50}
					date={finish.p50Date}
				/>
				<Stat
					label="P90 finish"
					tooltip="Safe commit date — 9 in 10 runs finished by here."
					days={finish.p90}
					date={finish.p90Date}
				/>
			</dl>
			<p className="text-xs text-muted-foreground">
				Across {result.trials.toLocaleString()} simulated runs.
			</p>

			{mostLikely && (
				<div
					className="flex items-baseline justify-between rounded-md border bg-background/50 p-2.5"
					title="A single deterministic schedule using each task's most-likely estimate — everything goes as planned, no variance."
					data-testid="mc-most-likely"
				>
					<span className="text-xs text-muted-foreground">
						Most-likely finish
					</span>
					<span className="flex items-baseline gap-1.5">
						<span className="text-sm font-semibold tabular-nums">
							{mostLikely.projectFinishDate}
						</span>
						<span className="text-xs text-muted-foreground tabular-nums">
							{formatDays(mostLikely.projectDuration)} d
						</span>
					</span>
				</div>
			)}

			{staffed && (
				<div className="space-y-1.5" data-testid="mc-staffed">
					<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
						<UsersIcon className="size-3.5" />
						With parallel staffing
					</div>
					<dl className="grid grid-cols-2 gap-3">
						<Stat
							label="P50 finish"
							tooltip="Coin-flip date with big tasks crashed across multiple equal people."
							days={staffed.p50}
							date={staffed.p50Date}
						/>
						<Stat
							label="P90 finish"
							tooltip="Safe commit date with big tasks crashed across multiple equal people."
							days={staffed.p90}
							date={staffed.p90Date}
						/>
					</dl>
					<p className="text-xs text-muted-foreground">
						Assumes up to the configured people per task with linear speedup —
						optimistic, since it ignores coordination cost.
					</p>
				</div>
			)}

			{topTasks.length > 0 && (
				<div className="space-y-1.5">
					<div className="text-xs font-medium text-muted-foreground">
						Most critical tasks
					</div>
					<table className="w-full text-xs" data-testid="mc-top-tasks">
						<thead>
							<tr className="text-muted-foreground">
								<th scope="col" className="py-1 text-left font-normal">
									Task
								</th>
								<th scope="col" className="py-1 text-right font-normal">
									Critical
								</th>
								<th scope="col" className="py-1 text-right font-normal">
									P50
								</th>
								<th scope="col" className="py-1 text-right font-normal">
									P90
								</th>
							</tr>
						</thead>
						<tbody>
							{topTasks.map((t) => {
								const title = doc.tasksById[t.taskId]?.title ?? "Untitled";
								return (
									<tr key={t.taskId} className="border-t">
										<td className="max-w-0 truncate py-1 pr-2" title={title}>
											{title}
										</td>
										<td className="py-1 text-right tabular-nums">
											{Math.round(t.criticality * 100)}%
										</td>
										<td className="py-1 text-right tabular-nums text-muted-foreground">
											{t.p50Date}
										</td>
										<td className="py-1 text-right tabular-nums text-muted-foreground">
											{t.p90Date}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function Stat({
	label,
	tooltip,
	days,
	date,
}: {
	label: string;
	tooltip: string;
	days: number;
	date: string;
}) {
	return (
		<div className="rounded-md border bg-background/50 p-2.5" title={tooltip}>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-0.5 flex items-baseline gap-1.5">
				<span className="text-sm font-semibold tabular-nums">{date}</span>
				<span className="text-xs text-muted-foreground tabular-nums">
					{formatDays(days)} d
				</span>
			</dd>
		</div>
	);
}

function formatDays(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

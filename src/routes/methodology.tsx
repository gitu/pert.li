import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingFooter } from "#/components/marketing/marketing-footer";
import { MarketingHeader } from "#/components/marketing/marketing-header";
import { useAppConfig } from "#/lib/app-config";

export const Route = createFileRoute("/methodology")({
	component: MethodologyPage,
});

// Static reference page documenting every number the app derives from a task
// graph: the PERT expected value, the CPM schedule, team-capacity scaling, and
// the Monte Carlo forecast. Kept in sync with the real engines:
//   • expected / variance / CPM / team capacity → src/lib/pert/schedule.ts
//   • Beta-PERT sampling / percentiles / criticality → src/lib/pert/montecarlo.ts
//   • ±1.96σ confidence band → src/components/pert/list/task-list-view.tsx
function MethodologyPage() {
	const { appName } = useAppConfig();

	return (
		<div className="flex min-h-svh flex-col bg-background">
			<MarketingHeader width="reading" />

			<main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-12 pb-16">
				<article className="prose prose-zinc dark:prose-invert max-w-none">
					<h1 className="text-3xl font-semibold tracking-tight">
						How the numbers are calculated
					</h1>
					<p className="text-sm text-muted-foreground">
						{appName} turns a graph of tasks, estimates, and dependencies into a
						schedule and a risk forecast. Everything below is computed
						deterministically in your browser from the estimates you enter — no
						data leaves the document. This page explains each formula so you can
						trust (and check) the results.
					</p>

					<nav className="mt-6 rounded-md border bg-muted/20 p-4 text-sm not-prose">
						<p className="mb-2 font-medium">On this page</p>
						<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
							<li>
								<a href="#three-point">Three-point estimates</a>
							</li>
							<li>
								<a href="#expected">Expected duration</a>
							</li>
							<li>
								<a href="#uncertainty">Uncertainty &amp; confidence band</a>
							</li>
							<li>
								<a href="#cpm">Critical Path Method (the schedule)</a>
							</li>
							<li>
								<a href="#team">Team capacity: effort vs. duration</a>
							</li>
							<li>
								<a href="#montecarlo">Monte Carlo forecast</a>
							</li>
							<li>
								<a href="#units">Units &amp; the working-day calendar</a>
							</li>
						</ul>
					</nav>

					{/* ── Three-point estimates ─────────────────────────────── */}
					<h2 id="three-point" className="mt-10 scroll-mt-20">
						Three-point estimates
					</h2>
					<p>
						Each task is estimated with three numbers instead of one, which
						captures how uncertain the work is:
					</p>
					<ul>
						<li>
							<strong>Optimistic (o)</strong> — everything goes right; the
							best-case time.
						</li>
						<li>
							<strong>Most likely (m)</strong> — the single most probable
							outcome, the mode.
						</li>
						<li>
							<strong>Pessimistic (p)</strong> — realistic worst case (not
							catastrophe, but a bad run).
						</li>
					</ul>
					<p>
						The app enforces <code>o ≤ m ≤ p</code>. A wide gap between{" "}
						<code>o</code> and <code>p</code> means a risky task — that risk
						flows into every downstream number.
					</p>

					{/* ── Expected duration ─────────────────────────────────── */}
					<h2 id="expected" className="mt-10 scroll-mt-20">
						Expected duration (the PERT weighted mean)
					</h2>
					<p>
						The single &ldquo;expected&rdquo; duration is the classic Beta-PERT
						weighted average. The most-likely value counts four times as much as
						either extreme:
					</p>
					<pre className="not-prose rounded-md border bg-muted/30 p-4 text-sm">
						<code>{`E = (o + 4·m + p) / 6`}</code>
					</pre>
					<p>
						The weights sum to <strong>6</strong> (1 + 4 + 1), so you divide by
						6 — a common mistake is dividing by 3. Worked example for an
						estimate of <code>2.5 / 10.7 / 11.5</code> days:
					</p>
					<pre className="not-prose rounded-md border bg-muted/30 p-4 text-sm">
						<code>{`E = (2.5 + 4·10.7 + 11.5) / 6
  = (2.5 + 42.8 + 11.5) / 6
  = 56.8 / 6
  ≈ 9.47 days`}</code>
					</pre>
					<p>
						This is the duration shown on each task and fed into the schedule —
						unless team-capacity scaling is on (see below), which can stretch
						it.
					</p>

					{/* ── Uncertainty ───────────────────────────────────────── */}
					<h2 id="uncertainty" className="mt-10 scroll-mt-20">
						Uncertainty &amp; the confidence band
					</h2>
					<p>
						The optimistic–pessimistic spread defines each task&rsquo;s standard
						deviation and variance:
					</p>
					<pre className="not-prose rounded-md border bg-muted/30 p-4 text-sm">
						<code>{`σ  = (p − o) / 6
σ² = ((p − o) / 6)²`}</code>
					</pre>
					<p>
						The &ldquo;÷6&rdquo; assumes the optimistic and pessimistic points
						sit roughly ±3σ from the mean. Variances of independent tasks{" "}
						<strong>add</strong>, so a group&rsquo;s ±95% confidence band sums
						the per-task variances in quadrature:
					</p>
					<pre className="not-prose rounded-md border bg-muted/30 p-4 text-sm">
						<code>{`band = ±1.96 · √(Σ σ²)`}</code>
					</pre>
					<p>
						1.96 is the 95% z-score of a normal distribution. This is a quick
						analytic estimate; the Monte Carlo forecast below is the more honest
						(and skew-aware) version.
					</p>

					{/* ── CPM ───────────────────────────────────────────────── */}
					<h2 id="cpm" className="mt-10 scroll-mt-20">
						Critical Path Method — the schedule
					</h2>
					<p>
						Dependencies turn the estimates into a schedule. A single forward
						pass and a single backward pass over the dependency graph (in
						topological order) produce four numbers per task, all in days from
						project start:
					</p>
					<ul>
						<li>
							<strong>ES</strong> (earliest start) and{" "}
							<strong>EF = ES + duration</strong> (earliest finish) — the
							forward pass; a task can&rsquo;t start until all its predecessors
							finish (respecting the dependency type and any lag).
						</li>
						<li>
							<strong>LF</strong> (latest finish) and{" "}
							<strong>LS = LF − duration</strong> (latest start) — the backward
							pass from the project end.
						</li>
						<li>
							<strong>Slack = LS − ES</strong> — how long the task can slip
							without moving the project finish.
						</li>
					</ul>
					<p>
						Tasks with <strong>zero slack</strong> form the{" "}
						<strong>critical path</strong> — the chain that determines the
						project duration. All four finish-to-start, start-to-start,
						finish-to-finish, and start-to-finish dependency types are
						supported, each with an optional lag. If the graph contains a cycle
						the scheduler reports it instead of guessing.
					</p>
					<p>
						In-progress tasks burn down: a task reported <code>40%</code> done
						contributes only its remaining <code>60%</code> to the schedule, and
						completed tasks contribute zero.
					</p>

					{/* ── Team capacity ─────────────────────────────────────── */}
					<h2 id="team" className="mt-10 scroll-mt-20">
						Team capacity: effort vs. duration
					</h2>
					<p>
						In the default <strong>Calendar mode</strong>, each estimate is
						treated as a calendar-day cost and the schedule assumes whoever is
						assigned can work it without contention. Switching the project
						calendar to <strong>Team capacity</strong> mode models a finite
						team. Daily capacity is:
					</p>
					<pre className="not-prose rounded-md border bg-muted/30 p-4 text-sm">
						<code>{`capacity = peopleCount × availability%   (person-days per day)`}</code>
					</pre>
					<p>
						For each task the engine counts its <strong>peers</strong> — the
						maximum number of other tasks whose baseline [ES, EF) window
						overlaps it (the worst-case &ldquo;everyone&rsquo;s busy at
						once&rdquo; assumption). How that stretches the task depends on what
						your estimates <em>mean</em>, which you choose with the{" "}
						<strong>&ldquo;Estimates represent&rdquo;</strong> toggle:
					</p>
					<ul>
						<li>
							<strong>Effort (person-days)</strong> — the estimate is work, not
							time. A task takes <code>E × peers / capacity</code> calendar
							days, so even a task alone in its window stretches when
							there&rsquo;s less than one full person on it. A 9.47-person-day
							task with half a person available takes{" "}
							<code>9.47 / 0.5 ≈ 18.9</code> days.
						</li>
						<li>
							<strong>Duration (calendar days)</strong> — the estimate already
							assumes one assignee. A task alone in its window keeps its
							estimate no matter how small the team is; only genuine
							over-subscription stretches it, by{" "}
							<code>max(1, peers / max(capacity, 1))</code>. The same task stays
							at <code>≈ 9.5</code> days on its own, but three tasks competing
							for two people still each stretch ×1.5.
						</li>
					</ul>
					<p>
						Either way the original PERT value is preserved separately (shown as
						&ldquo;expected&rdquo;), so you can always see the unscaled
						estimate. Team mode can also derive capacity from your{" "}
						<strong>historic velocity</strong> (delivered person-days ÷ elapsed
						working days) once you have completed tasks with real start/finish
						dates.
					</p>

					{/* ── Monte Carlo ───────────────────────────────────────── */}
					<h2 id="montecarlo" className="mt-10 scroll-mt-20">
						Monte Carlo forecast
					</h2>
					<p>
						A single expected date hides risk. The Monte Carlo simulation runs
						the whole schedule thousands of times, drawing a random duration for
						every task each run, and reports the distribution of outcomes.
					</p>
					<p>
						Each task&rsquo;s duration is sampled from a{" "}
						<strong>Beta-PERT distribution</strong> bounded on{" "}
						<code>[o, p]</code> with its peak at <code>m</code> — so samples are
						always realistic (never negative, never beyond the pessimistic
						bound) and skewed the way your estimate is. The shape parameters
						(with <code>λ = 4</code>, the textbook value):
					</p>
					<pre className="not-prose rounded-md border bg-muted/30 p-4 text-sm">
						<code>{`α = 1 + λ·(m − o) / (p − o)
β = 1 + λ·(p − m) / (p − o)`}</code>
					</pre>
					<p>
						By default <strong>2,000 trials</strong> run. Across the trials the
						app reports, for the project finish and per task:
					</p>
					<ul>
						<li>
							<strong>p50</strong> — the median; a coin-flip you finish by this
							date.
						</li>
						<li>
							<strong>p90</strong> — you finish by this date in 90% of trials. A
							large gap between p50 and p90 signals fragile timing.
						</li>
						<li>
							<strong>p10</strong> — the optimistic 10th percentile.
						</li>
						<li>
							<strong>Criticality</strong> — the share of trials in which a task
							landed on that trial&rsquo;s critical path. A task that&rsquo;s
							critical in 80%+ of trials drives the finish in almost every
							plausible world — protect its estimate. Because durations are
							random, the critical path itself changes between trials, which a
							single CPM pass can&rsquo;t show.
						</li>
					</ul>
					<p>
						Completed and in-progress work is honoured here too: finished tasks
						contribute zero, and a half-done task contributes half its variance.
					</p>

					{/* ── Units ─────────────────────────────────────────────── */}
					<h2 id="units" className="mt-10 scroll-mt-20">
						Units &amp; the working-day calendar
					</h2>
					<p>
						Estimates can be entered in <strong>hours, days, or weeks</strong>.
						The engine normalises everything to days (1 hour = 1/24 day, 1 week
						= 7 days) before scheduling, so a project can mix units freely. Day
						offsets are then mapped to real calendar dates using the
						project&rsquo;s <strong>working days</strong> (default Mon–Fri) and{" "}
						<strong>holidays</strong>, so a 5-day task starting Thursday lands
						the following Wednesday rather than over the weekend.
					</p>

					<hr className="my-10" />
					<p className="text-sm text-muted-foreground">
						Want to go deeper? The whole engine is open source and unit-tested —
						read <code>src/lib/pert/schedule.ts</code> and{" "}
						<code>src/lib/pert/montecarlo.ts</code>. Or just{" "}
						<Link to="/">open a project</Link> and hover any computed value for
						an inline tooltip.
					</p>
				</article>
			</main>

			<MarketingFooter width="reading" />
		</div>
	);
}

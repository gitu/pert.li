import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
	explainConfidenceBand,
	explainCriticality,
	explainEarliestFinish,
	explainEarliestStart,
	explainExpectedDuration,
	explainLatestFinish,
	explainLatestStart,
	explainProjectDuration,
	explainProjectP50,
	explainProjectP90,
	explainSlack,
	fmtDays,
} from "#/lib/pert/explain";
import { computeSchedule, type TaskSchedule } from "#/lib/pert/schedule";
import type { Estimate, PertDoc, Task } from "#/lib/pert/types";
import { createEmptyPertDoc } from "#/lib/pert/types";

// Living documentation for the EXPLAINERS (src/lib/pert/explain.ts). Every
// derived number in the app carries a hover tooltip explaining how it was
// computed; tooltips don't show up in screenshots, so this story renders the
// real explainer strings — fed by the real schedule engine — as visible text.
//
// Deterministic: the explainers report day OFFSETS (numbers), not calendar
// dates, so there's no today()-dependent drift to flag for screenshot diffing.

const est = (o: number, m: number, p: number, unit: Estimate["unit"] = "day") =>
	({ optimistic: o, mostLikely: m, pessimistic: p, unit }) satisfies Estimate;

function task(id: string, title: string, over: Partial<Task> = {}): Task {
	return { id, kind: "task", title, ...over };
}

// One project exercising the cases the explainers reconcile:
//   • a skewed estimate where most-likely ≠ the PERT mean,
//   • an in-progress task (burn-down note in the duration explainer),
//   • a non-day unit (weeks → day conversion in the formula),
//   • a critical chain (zero-slack wording).
function showcaseDoc(): PertDoc {
	const d = createEmptyPertDoc("Explainers showcase");
	d.tasksById = {
		design: task("design", "Design API", { estimate: est(2, 5, 8) }),
		build: task("build", "Build service", { estimate: est(1, 2, 9) }),
		migrate: task("migrate", "Migrate database", {
			estimate: est(18, 20, 24),
			status: "in_progress",
			progress: 40,
		}),
		research: task("research", "Spike research", {
			estimate: est(1, 2, 3, "week"),
		}),
	};
	d.dependenciesById = {
		d1: {
			id: "d1",
			from: { taskId: "design" },
			to: { taskId: "build" },
			type: "finish_to_start",
		},
		d2: {
			id: "d2",
			from: { taskId: "build" },
			to: { taskId: "migrate" },
			type: "finish_to_start",
		},
	};
	return d;
}

function Row({
	label,
	value,
	explain,
}: {
	label: string;
	value: string;
	explain: string;
}) {
	return (
		<div className="grid grid-cols-[7rem_4rem_1fr] items-baseline gap-x-3 gap-y-0.5 border-t py-1.5 text-xs">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-semibold tabular-nums">{value}</dd>
			<dd className="text-muted-foreground leading-snug">{explain}</dd>
		</div>
	);
}

function TaskCalc({ t, s }: { t: Task; s: TaskSchedule }) {
	const f = fmtDays;
	const e = t.estimate;
	return (
		<div
			className="rounded-md border bg-card/40 p-3"
			data-testid={`calc-${t.id}`}
		>
			<div className="mb-1 flex items-baseline justify-between">
				<span className="font-medium">{t.title}</span>
				{e && (
					<span className="text-xs text-muted-foreground tabular-nums">
						{e.optimistic} / {e.mostLikely} / {e.pessimistic} {e.unit}
					</span>
				)}
			</div>
			<dl>
				<Row
					label="Duration"
					value={`${f(s.expected)} d`}
					explain={explainExpectedDuration(t.estimate, s)}
				/>
				<Row
					label="Slack"
					value={`${f(s.slack)} d`}
					explain={explainSlack(s)}
				/>
				<Row
					label="Earliest start"
					value={`day ${f(s.earliestStart)}`}
					explain={explainEarliestStart(s)}
				/>
				<Row
					label="Earliest finish"
					value={`day ${f(s.earliestFinish)}`}
					explain={explainEarliestFinish(s)}
				/>
				<Row
					label="Latest start"
					value={`day ${f(s.latestStart)}`}
					explain={explainLatestStart(s)}
				/>
				<Row
					label="Latest finish"
					value={`day ${f(s.latestFinish)}`}
					explain={explainLatestFinish(s)}
				/>
			</dl>
		</div>
	);
}

function ExplainersShowcase() {
	const doc = showcaseDoc();
	const result = computeSchedule(doc);
	const schedule = result.ok ? result.schedule : null;
	const tasks = Object.values(doc.tasksById);

	return (
		<div className="max-w-3xl space-y-4 p-4">
			<div>
				<h2 className="text-sm font-semibold">Per-task calculations</h2>
				<p className="text-xs text-muted-foreground">
					The number shown to the user, and the explainer behind it.
				</p>
			</div>
			<div className="space-y-3">
				{schedule
					? tasks.map((t) => {
							const s = schedule.tasks[t.id];
							return s ? <TaskCalc key={t.id} t={t} s={s} /> : null;
						})
					: null}
			</div>

			<div>
				<h2 className="text-sm font-semibold">Project &amp; Monte Carlo</h2>
			</div>
			<div className="space-y-2 rounded-md border bg-card/40 p-3 text-xs">
				<p data-testid="explain-project-duration">
					<span className="font-medium">Project duration.</span>{" "}
					<span className="text-muted-foreground">
						{explainProjectDuration}
					</span>
				</p>
				<p>
					<span className="font-medium">P50 finish.</span>{" "}
					<span className="text-muted-foreground">{explainProjectP50}</span>
				</p>
				<p>
					<span className="font-medium">P90 finish.</span>{" "}
					<span className="text-muted-foreground">{explainProjectP90}</span>
				</p>
				<p data-testid="explain-criticality">
					<span className="font-medium">Criticality 82%.</span>{" "}
					<span className="text-muted-foreground">
						{explainCriticality(0.82)}
					</span>
				</p>
				<p data-testid="explain-confidence">
					<span className="font-medium">±2.5 d band.</span>{" "}
					<span className="text-muted-foreground">
						{explainConfidenceBand(2.5, 4)}
					</span>
				</p>
			</div>
		</div>
	);
}

const meta = {
	title: "PERT/Explainers",
	component: ExplainersShowcase,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ExplainersShowcase>;

export default meta;
type Story = StoryObj<typeof meta>;

// The full catalogue: every per-task and project explainer, with real numbers
// from the schedule engine.
export const AllCalculations: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// The PERT formula is worked out with the actual operands.
		await expect(
			await canvas.findByText(/\(2 \+ 4·5 \+ 8\) \/ 6 = 5/),
		).toBeInTheDocument();
		// The skewed task (1/2/9 → expected 3, most-likely 2) is reconciled.
		await expect(
			await canvas.findByText(/\(1 \+ 4·2 \+ 9\) \/ 6 = 3/),
		).toBeInTheDocument();
		// The in-progress task surfaces the burn-down note.
		await expect(
			(await canvas.findByTestId("calc-migrate")).textContent,
		).toMatch(/40% done/);
		// The weeks-unit task converts into days inside the formula.
		await expect(
			(await canvas.findByTestId("calc-research")).textContent,
		).toMatch(/weeks = 14 d/);
		// Project + MC explainers render.
		await expect(
			(await canvas.findByTestId("explain-criticality")).textContent,
		).toMatch(/82% of 1,500/);
		await expect(
			(await canvas.findByTestId("explain-confidence")).textContent,
		).toMatch(/±2.5 d/);
	},
};

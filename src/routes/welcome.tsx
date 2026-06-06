import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	BotIcon,
	GitBranchIcon,
	LayersIcon,
	NetworkIcon,
	SparklesIcon,
	UsersIcon,
} from "lucide-react";
import { MarketingFooter } from "#/components/marketing/marketing-footer";
import { MarketingHeader } from "#/components/marketing/marketing-header";
import { Button } from "#/components/ui/button";
import { useAppConfig } from "#/lib/app-config";
import { markWelcomeSeen } from "#/lib/welcome";

export const Route = createFileRoute("/welcome")({
	component: WelcomePage,
});

// Marketing on-ramp for first-time visitors. Anything protected by the `_app`
// layout redirects signed-out users here; returning visitors (who already have
// the localStorage flag) get sent to /signin directly so they aren't stuck
// re-reading the pitch.

function WelcomePage() {
	return (
		<div className="flex min-h-svh flex-col bg-background">
			<MarketingHeader width="wide" />

			<main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-4 pt-14">
				<Hero />
				<FeatureGrid />
				<HowItWorks />
				<CallToAction />
			</main>

			<MarketingFooter width="wide" />
		</div>
	);
}

function Hero() {
	const { appName } = useAppConfig();
	return (
		<section className="rounded-2xl border bg-card p-10 shadow-sm sm:p-16">
			<div className="max-w-2xl">
				<span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand">
					<SparklesIcon className="size-3.5" />
					Collaborative PERT, with an AI co-planner
				</span>
				<h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
					Plan something nested.
				</h1>
				<p className="mt-5 max-w-prose text-base leading-relaxed text-muted-foreground sm:text-lg">
					{appName} turns rough scopes into PERT charts you can actually steer:
					three-point estimates, a deterministic critical path, nested
					sub-projects, and a chat assistant that creates the tasks for you.
					Every edit syncs live — no save button, no merge conflicts.
				</p>
				<div className="mt-8 flex flex-wrap gap-3">
					<Button asChild size="lg">
						<Link to="/signin" onClick={() => markWelcomeSeen()}>
							Create your first project
							<ArrowRightIcon className="size-4" />
						</Link>
					</Button>
					<Button
						asChild
						size="lg"
						variant="outline"
						className="text-foreground"
					>
						<Link to="/signin" onClick={() => markWelcomeSeen()}>
							I already have an account
						</Link>
					</Button>
				</div>
			</div>
		</section>
	);
}

const FEATURES: ReadonlyArray<{
	icon: typeof NetworkIcon;
	title: string;
	body: string;
}> = [
	{
		icon: NetworkIcon,
		title: "PERT done right",
		body: "Three-point estimates (optimistic / most likely / pessimistic), automatic ES/EF/LS/LF, slack, and a critical path that updates as you type.",
	},
	{
		icon: GitBranchIcon,
		title: "Nested containers",
		body: "Break work into sub-projects with their own interfaces. Collapse a branch when it's noise; expand it when it's the work.",
	},
	{
		icon: UsersIcon,
		title: "Live collaboration",
		body: "Built on Automerge. Two people edit the same plan, sees the same critical path, and never lose a keystroke to a merge conflict.",
	},
	{
		icon: BotIcon,
		title: "AI co-planner",
		body: "An assistant that can read your plan and actually create tasks, set estimates, and wire dependencies — or just teach you the method.",
	},
];

function FeatureGrid() {
	return (
		<section className="mt-24">
			<h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				What's in the box
			</h2>
			<div className="mt-5 grid gap-4 sm:grid-cols-2">
				{FEATURES.map(({ icon: Icon, title, body }) => (
					<div
						key={title}
						className="rounded-xl border bg-card p-6 transition-colors hover:bg-accent/40"
					>
						<div className="flex items-center gap-3">
							<div className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand">
								<Icon className="size-4.5" />
							</div>
							<h3 className="text-base font-semibold tracking-tight">
								{title}
							</h3>
						</div>
						<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
							{body}
						</p>
					</div>
				))}
			</div>
		</section>
	);
}

const STEPS: ReadonlyArray<{ n: string; title: string; body: string }> = [
	{
		n: "01",
		title: "Sketch the scope",
		body: "Type tasks into the canvas or describe them to the assistant in plain English — it'll create them, set estimates, and propose dependencies.",
	},
	{
		n: "02",
		title: "Find the critical path",
		body: "The CPM engine runs live. Watch slack, spot the bottleneck, and re-estimate without rebuilding the chart.",
	},
	{
		n: "03",
		title: "Steer with your team",
		body: "Share a project, invite collaborators, and edit together in real time. Browse history, compare versions, restore values.",
	},
];

function HowItWorks() {
	return (
		<section className="mt-24">
			<h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				How it works
			</h2>
			<div className="mt-5 grid gap-4 sm:grid-cols-3">
				{STEPS.map(({ n, title, body }) => (
					<div key={n} className="rounded-xl border bg-card p-6">
						<div className="font-mono text-sm font-semibold tracking-tight text-brand">
							{n}
						</div>
						<h3 className="mt-3 text-base font-semibold tracking-tight">
							{title}
						</h3>
						<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
							{body}
						</p>
					</div>
				))}
			</div>
		</section>
	);
}

function CallToAction() {
	return (
		<section className="mt-24 rounded-2xl border bg-card p-10 text-center shadow-sm sm:p-14">
			<div className="mx-auto grid size-11 place-items-center rounded-xl bg-brand/10 text-brand">
				<LayersIcon className="size-5" />
			</div>
			<h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
				Ready to plan something nested?
			</h2>
			<p className="mx-auto mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
				Sign up takes 30 seconds. A starter project, a tutorial assistant, and a
				dev database are waiting on the other side.
			</p>
			<div className="mt-7 flex flex-wrap justify-center gap-3">
				<Button asChild size="lg">
					<Link to="/signin" onClick={() => markWelcomeSeen()}>
						Get started — it's free
						<ArrowRightIcon className="size-4" />
					</Link>
				</Button>
			</div>
		</section>
	);
}

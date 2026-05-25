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
import { Button } from "#/components/ui/button";
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
		<div className="min-h-svh bg-background">
			<header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
				<Link to="/" className="flex items-center gap-2">
					<div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
						<LayersIcon className="size-4" />
					</div>
					<span className="text-base font-semibold tracking-tight">
						pert.li
					</span>
				</Link>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost" size="sm">
						<Link to="/signin" onClick={() => markWelcomeSeen()}>
							Sign in
						</Link>
					</Button>
					<Button asChild size="sm">
						<Link to="/signin" onClick={() => markWelcomeSeen()}>
							Get started
							<ArrowRightIcon className="size-4" />
						</Link>
					</Button>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
				<Hero />
				<FeatureGrid />
				<HowItWorks />
				<CallToAction />
			</main>

			<footer className="border-t">
				<div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
					<div>pert.li — collaborative PERT planning.</div>
					<div className="flex items-center gap-3">
						<Link to="/signin" className="hover:text-foreground">
							Sign in
						</Link>
					</div>
				</div>
			</footer>
		</div>
	);
}

function Hero() {
	return (
		<section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.08] via-card to-card p-10 sm:p-14">
			<div
				aria-hidden
				className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/10 blur-3xl"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-primary/5 blur-3xl"
			/>
			<div className="relative max-w-2xl">
				<span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-primary">
					<SparklesIcon className="size-3.5" />
					Collaborative PERT, with an AI co-planner
				</span>
				<h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
					Plan something nested.
				</h1>
				<p className="mt-4 max-w-prose text-base text-muted-foreground sm:text-lg">
					pert.li turns rough scopes into PERT charts you can actually steer:
					three-point estimates, a deterministic critical path, nested
					sub-projects, and a chat assistant that creates the tasks for you.
					Every edit syncs live — no save button, no merge conflicts.
				</p>
				<div className="mt-7 flex flex-wrap gap-3">
					<Button asChild size="lg">
						<Link to="/signin" onClick={() => markWelcomeSeen()}>
							Create your first project
							<ArrowRightIcon className="size-4" />
						</Link>
					</Button>
					<Button asChild size="lg" variant="secondary">
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
		<section className="mt-20">
			<h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
				What's in the box
			</h2>
			<div className="mt-4 grid gap-4 sm:grid-cols-2">
				{FEATURES.map(({ icon: Icon, title, body }) => (
					<div
						key={title}
						className="rounded-xl border bg-card p-5 transition-colors hover:bg-accent/20"
					>
						<div className="flex items-center gap-2.5">
							<div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
								<Icon className="size-4.5" />
							</div>
							<h3 className="text-base font-semibold tracking-tight">
								{title}
							</h3>
						</div>
						<p className="mt-3 text-sm text-muted-foreground">{body}</p>
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
		<section className="mt-20">
			<h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
				How it works
			</h2>
			<div className="mt-4 grid gap-4 sm:grid-cols-3">
				{STEPS.map(({ n, title, body }) => (
					<div key={n} className="rounded-xl border bg-card p-5">
						<div className="text-2xl font-semibold tracking-tight text-primary/70">
							{n}
						</div>
						<h3 className="mt-2 text-base font-semibold tracking-tight">
							{title}
						</h3>
						<p className="mt-2 text-sm text-muted-foreground">{body}</p>
					</div>
				))}
			</div>
		</section>
	);
}

function CallToAction() {
	return (
		<section className="mt-20 rounded-2xl border bg-card p-8 text-center sm:p-12">
			<h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
				Ready to plan something nested?
			</h2>
			<p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground sm:text-base">
				Sign up takes 30 seconds. A starter project, a tutorial assistant, and a
				dev database are waiting on the other side.
			</p>
			<div className="mt-6 flex flex-wrap justify-center gap-3">
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

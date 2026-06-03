import { GraduationCapIcon, SparklesIcon } from "lucide-react";
import { TUTORIAL_SEEDS } from "#/components/ai/tutorial-seeds";
import { Button } from "#/components/ui/button";
import { chatDock } from "#/lib/chat-dock";
import { cn } from "#/lib/utils";

export type TutorialCardProps = {
	className?: string;
	// `onStart` is optional — when omitted, the card defaults to opening the
	// chat dock with the seeded prompt. Tests/Storybook can spy via the prop.
	onStart?: (prompt: string, label: string) => void;
};

// Prominent on-ramp shown to first-time and near-first-time users. The
// assistant is the tutorial: each chip launches the chat (pinned to the side)
// with a beginner-friendly seed prompt and auto-sends it so the lesson starts
// immediately.
export function TutorialCard({ className, onStart }: TutorialCardProps) {
	const start = (prompt: string, label: string) => {
		if (onStart) onStart(prompt, label);
		else chatDock.startWith(prompt, { autoSend: true });
	};
	return (
		<div
			data-testid="tutorial-card"
			className={cn(
				"relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/[0.08] via-card to-card p-6 shadow-sm",
				className,
			)}
		>
			<div
				aria-hidden
				className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full bg-primary/10 blur-2xl"
			/>
			<div className="relative flex flex-col gap-4">
				<div className="flex items-start gap-3">
					<div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
						<GraduationCapIcon className="size-5" />
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h2 className="text-base font-semibold tracking-tight">
								New to PERT? Learn it with the assistant.
							</h2>
							<span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
								<SparklesIcon className="size-3" />
								Tutorial
							</span>
						</div>
						<p className="mt-1 max-w-prose text-sm text-muted-foreground">
							A short, interactive walkthrough — pick a topic and the chat opens
							beside your work. It can also create tasks, set estimates, and
							wire dependencies for you as you go.
						</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{TUTORIAL_SEEDS.map((seed) => (
						<Button
							key={seed.label}
							variant="secondary"
							size="sm"
							className="gap-1.5"
							onClick={() => start(seed.prompt, seed.label)}
							data-testid={`tutorial-seed-${seed.label
								.toLowerCase()
								.replace(/[^a-z0-9]+/g, "-")
								.replace(/^-+|-+$/g, "")}`}
						>
							{seed.label}
						</Button>
					))}
				</div>
			</div>
		</div>
	);
}

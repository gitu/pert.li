import { AlertCircleIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "#/components/ui/button";

// Discriminated state for the on-demand AI summary. The container owns the
// mutation; this card is pure presentation so Storybook can show every state.
export type SummaryState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "done"; text: string }
	| { status: "error"; message: string };

export function OverviewSummaryCard({
	state,
	onSummarize,
	disabled,
}: {
	state: SummaryState;
	onSummarize: () => void;
	disabled?: boolean;
}) {
	const loading = state.status === "loading";
	return (
		<section
			className="rounded-md border bg-card/40 p-4"
			data-testid="overview-ai-summary"
		>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-1.5 text-sm font-medium">
					<SparklesIcon className="size-4 text-brand" />
					AI summary
				</div>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-8 gap-1.5 text-xs"
					onClick={onSummarize}
					disabled={disabled || loading}
					data-testid="overview-ai-summarize"
				>
					{loading ? (
						<Loader2Icon className="size-3.5 animate-spin" />
					) : (
						<SparklesIcon className="size-3.5" />
					)}
					{state.status === "done" ? "Regenerate" : "Summarize"}
				</Button>
			</div>

			<div className="mt-3 text-sm">
				{state.status === "idle" && (
					<p className="text-muted-foreground">
						{disabled
							? "Switch to edit mode to generate a summary."
							: "Generate a short executive overview and the top risks for this plan."}
					</p>
				)}
				{state.status === "loading" && (
					<p className="flex items-center gap-2 text-muted-foreground">
						<Loader2Icon className="size-4 animate-spin" />
						Reading the plan…
					</p>
				)}
				{state.status === "error" && (
					<p className="flex items-start gap-2 text-destructive">
						<AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
						<span>{state.message}</span>
					</p>
				)}
				{state.status === "done" && (
					<div className="prose prose-sm prose-zinc dark:prose-invert max-w-none leading-relaxed text-foreground [&_ol]:my-2 [&_p]:my-2 [&_ul]:my-2">
						{/* Render the summary as markdown, but strip links: the AI
						summary describes the in-app plan, so any anchor would be
						noise — unwrapDisallowed keeps the link text as plain text. */}
						<Streamdown disallowedElements={["a"]} unwrapDisallowed>
							{state.text}
						</Streamdown>
					</div>
				)}
			</div>
		</section>
	);
}

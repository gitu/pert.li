import { AlertTriangleIcon, CheckIcon, SlashIcon } from "lucide-react";
import { cn } from "#/lib/utils";

// One-line counts strip for the merge drawer. Shown above the change list so
// the user knows what they're looking at without scanning the rows.
export type MergeSummaryProps = {
	clean: number;
	conflict: number;
	skipped: number;
	className?: string;
};

export function MergeSummary({
	clean,
	conflict,
	skipped,
	className,
}: MergeSummaryProps) {
	return (
		<div
			data-testid="merge-summary"
			className={cn(
				"flex flex-wrap items-center gap-3 border-b bg-card/40 px-3 py-2 text-xs",
				className,
			)}
		>
			<Pill
				icon={<CheckIcon className="size-3" />}
				count={clean}
				label="clean"
				tone="ok"
				testId="merge-summary-clean"
			/>
			<Pill
				icon={<AlertTriangleIcon className="size-3" />}
				count={conflict}
				label={conflict === 1 ? "conflict" : "conflicts"}
				tone={conflict > 0 ? "warn" : "muted"}
				testId="merge-summary-conflict"
			/>
			<Pill
				icon={<SlashIcon className="size-3" />}
				count={skipped}
				label="skipped"
				tone="muted"
				testId="merge-summary-skipped"
			/>
		</div>
	);
}

function Pill({
	icon,
	count,
	label,
	tone,
	testId,
}: {
	icon: React.ReactNode;
	count: number;
	label: string;
	tone: "ok" | "warn" | "muted";
	testId: string;
}) {
	return (
		<div
			data-testid={testId}
			className={cn(
				"flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px]",
				tone === "ok" && "border-primary/30 bg-primary/10 text-primary",
				tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-700",
				tone === "muted" && "border-border text-muted-foreground",
			)}
		>
			{icon}
			<span className="font-medium">{count}</span>
			<span>{label}</span>
		</div>
	);
}

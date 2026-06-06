import { useStore } from "@tanstack/react-store";
import {
	CheckCircle2Icon,
	CheckIcon,
	CircleDashedIcon,
	CircleIcon,
	ClipboardListIcon,
	ForwardIcon,
	Loader2Icon,
	PlayIcon,
	RepeatIcon,
	XCircleIcon,
	XIcon,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	planProgress,
	removeWorkPlanMutation,
	setWorkPlanStatusMutation,
} from "#/lib/ai/work-plan-mutators";
import { projectDocStore } from "#/lib/pert/store";
import type { WorkPlan, WorkPlanStepStatus } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// The plan-and-execute mode's two UI surfaces:
//
//  • WorkPlanCard — rendered inline in the chat when the assistant creates a
//    plan (the create_work_plan tool result carries a planId). Shows the full
//    step list. On DRAFT plans it carries the Approve / Reject buttons — the
//    user's approval is the review gate; once approved, step changes apply
//    directly to the doc.
//
//  • WorkPlanStatusBar — a thin persistent strip above the chat input while a
//    plan is active. The card scrolls away with the conversation; this
//    doesn't. Owns the execution-loop controls (Continue, auto-continue
//    toggle, Cancel).
//
// Both read doc.workPlan from the projectDocStore — the plan lives in the
// Automerge doc itself (synced, collaborative), not in a client-side store.

export type WorkPlanCardProps = {
	// The plan id from the tool result. Used only to detect staleness: if the
	// doc's current plan has a different id, this card renders as a historical
	// stub (the plan it referred to was replaced).
	planId: string;
};

export function WorkPlanCard({ planId }: WorkPlanCardProps) {
	const doc = useStore(projectDocStore, (s) => s.doc);
	const changeDoc = useStore(projectDocStore, (s) => s.changeDoc);
	const plan = doc?.workPlan;

	if (!plan || plan.id !== planId) {
		return (
			<div
				className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground"
				data-testid={`work-plan-card-${planId}`}
				data-state="stale"
			>
				<span className="font-medium">Plan replaced or removed</span>
				<span className="ml-1">— a newer plan supersedes this one.</span>
			</div>
		);
	}

	const progress = planProgress(plan);
	const readOnly = !changeDoc;

	const approve = () => {
		if (!changeDoc) return;
		changeDoc((d) => {
			setWorkPlanStatusMutation(d, { status: "approved" });
		});
	};

	const reject = () => {
		if (!changeDoc) return;
		// A rejected draft is deleted outright — it was never approved, so there
		// is no execution record worth keeping.
		changeDoc((d) => {
			removeWorkPlanMutation(d);
		});
	};

	return (
		<div
			className="overflow-hidden rounded-md border border-primary/30 bg-card"
			data-testid={`work-plan-card-${planId}`}
			data-state={plan.status}
		>
			<header className="flex flex-wrap items-start gap-2 border-b bg-primary/5 px-3 py-2">
				<div className="flex min-w-0 flex-1 items-start gap-2">
					<ClipboardListIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
					<div className="min-w-0 flex-1">
						<div className="text-[10px] font-medium uppercase tracking-wide text-primary">
							Work plan · {statusLabel(plan.status)}
						</div>
						<p className="text-xs font-medium leading-snug">{plan.title}</p>
						<p className="text-[11px] leading-snug text-muted-foreground">
							{plan.rationale}
						</p>
					</div>
				</div>
				<div
					className="shrink-0 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
					data-testid="work-plan-progress"
				>
					{progress.completed}/{progress.total}
					{progress.failed > 0 && (
						<span className="text-destructive">
							{" "}
							· {progress.failed} failed
						</span>
					)}
				</div>
			</header>
			<ol className="space-y-1 px-3 py-2" data-testid="work-plan-steps">
				{plan.steps.map((step, i) => (
					<li
						key={step.id}
						className="flex items-start gap-2 text-xs"
						data-testid="work-plan-step"
						data-status={step.status}
					>
						<StepStatusIcon status={step.status} />
						<div className="min-w-0">
							<span
								className={cn(
									step.status === "completed" &&
										"text-muted-foreground line-through",
									step.status === "failed" && "text-destructive",
								)}
							>
								<span className="text-muted-foreground">{i + 1}.</span>{" "}
								{step.title}
							</span>
							{step.result && (
								<div className="text-[10px] text-muted-foreground">
									{step.result}
								</div>
							)}
						</div>
					</li>
				))}
			</ol>
			{plan.status === "draft" && (
				<footer className="flex items-center justify-end gap-1.5 border-t bg-card/40 px-3 py-2">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 gap-1 px-2 text-[11px]"
						onClick={reject}
						disabled={readOnly}
						data-testid={`work-plan-reject-${planId}`}
					>
						<XIcon className="size-3" /> Reject
					</Button>
					<Button
						type="button"
						size="sm"
						className="h-7 gap-1 px-2 text-[11px]"
						onClick={approve}
						disabled={readOnly}
						data-testid={`work-plan-approve-${planId}`}
					>
						<CheckIcon className="size-3" /> Approve plan
					</Button>
				</footer>
			)}
		</div>
	);
}

function statusLabel(status: WorkPlan["status"]): string {
	switch (status) {
		case "draft":
			return "awaiting approval";
		case "approved":
			return "approved";
		case "executing":
			return "executing";
		case "completed":
			return "completed";
		case "cancelled":
			return "cancelled";
	}
}

function StepStatusIcon({ status }: { status: WorkPlanStepStatus }) {
	switch (status) {
		case "pending":
			return (
				<CircleIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
			);
		case "in_progress":
			return (
				<Loader2Icon className="mt-0.5 size-3 shrink-0 animate-spin text-primary" />
			);
		case "completed":
			return (
				<CheckCircle2Icon className="mt-0.5 size-3 shrink-0 text-green-600 dark:text-green-500" />
			);
		case "failed":
			return (
				<XCircleIcon className="mt-0.5 size-3 shrink-0 text-destructive" />
			);
		case "skipped":
			return (
				<ForwardIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
			);
	}
}

// ── Persistent status bar ───────────────────────────────────────────────────

export type WorkPlanStatusBarProps = {
	// Sends a message into the active chat thread (wired to the thread API by
	// BoundChatPanel).
	onContinue: (message: string) => void;
	// The auto-continue (Ralph loop) toggle state + setter — owned by the
	// panel so the loop effect and this bar share one source of truth.
	autoContinue: boolean;
	onToggleAutoContinue: (next: boolean) => void;
	// Auto-continue loop progress toward the runaway-loop cap. Surfaced on the
	// Auto button so the user can see how many turns have fired and how many
	// remain before the loop stops on its own.
	autoTurns?: number;
	autoCap?: number;
	// True while the assistant is streaming — Continue is disabled then.
	busy: boolean;
};

export const CONTINUE_PLAN_MESSAGE =
	"Continue executing the work plan: read it with get_work_plan, then complete the next pending step.";

export function WorkPlanStatusBar({
	onContinue,
	autoContinue,
	onToggleAutoContinue,
	autoTurns,
	autoCap,
	busy,
}: WorkPlanStatusBarProps) {
	const doc = useStore(projectDocStore, (s) => s.doc);
	const changeDoc = useStore(projectDocStore, (s) => s.changeDoc);
	const plan = doc?.workPlan;

	// Only show while there's a plan that needs attention or is mid-execution.
	if (!plan || plan.status === "completed" || plan.status === "cancelled") {
		return null;
	}

	const progress = planProgress(plan);
	const cancel = () => {
		if (!changeDoc) return;
		changeDoc((d) => {
			if (d.workPlan?.status === "draft") {
				removeWorkPlanMutation(d);
			} else {
				setWorkPlanStatusMutation(d, { status: "cancelled" });
			}
		});
	};

	return (
		<div
			className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-primary/5 px-3 py-1.5 text-[11px]"
			data-testid="work-plan-status-bar"
			data-plan-status={plan.status}
		>
			<ClipboardListIcon className="size-3.5 shrink-0 text-primary" />
			<span className="min-w-0 truncate font-medium">{plan.title}</span>
			<span
				className="text-muted-foreground"
				data-testid="work-plan-bar-progress"
			>
				{progress.completed}/{progress.total}
				{progress.failed > 0 && (
					<span className="text-destructive"> · {progress.failed} failed</span>
				)}
			</span>
			<div className="ml-auto flex items-center gap-1">
				{plan.status === "draft" ? (
					<span className="text-muted-foreground">awaiting approval</span>
				) : (
					<>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							className="h-6 gap-1 px-2 text-[10px]"
							disabled={busy}
							onClick={() => onContinue(CONTINUE_PLAN_MESSAGE)}
							data-testid="work-plan-continue"
						>
							<PlayIcon className="size-3" /> Continue
						</Button>
						<Button
							type="button"
							size="sm"
							variant={autoContinue ? "default" : "ghost"}
							className="h-6 gap-1 px-2 text-[10px]"
							onClick={() => onToggleAutoContinue(!autoContinue)}
							aria-pressed={autoContinue}
							data-testid="work-plan-auto-toggle"
						>
							{autoContinue ? (
								<Loader2Icon className={cn("size-3", busy && "animate-spin")} />
							) : (
								<RepeatIcon className="size-3" />
							)}
							{autoContinue && typeof autoTurns === "number" && autoCap
								? `Auto ${autoTurns}/${autoCap}`
								: "Auto"}
						</Button>
					</>
				)}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-6 gap-1 px-2 text-[10px]"
					onClick={cancel}
					data-testid="work-plan-cancel"
				>
					<CircleDashedIcon className="size-3" /> Cancel
				</Button>
			</div>
		</div>
	);
}

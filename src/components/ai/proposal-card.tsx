import { useStore } from "@tanstack/react-store";
import {
	CheckCheckIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	SparklesIcon,
	XCircleIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import {
	DiffBody,
	DiffCountBadges,
	type DiffRowKind,
} from "#/components/pert/history/diff-body";
import { Button } from "#/components/ui/button";
import type { EditOp } from "#/lib/ai/operations";
import {
	applyProposal,
	applyProposalRow,
	getProposal,
	proposalsStore,
	rejectProposal,
} from "#/lib/ai/proposals-store";
import { changeWith } from "#/lib/pert/change-meta";
import { projectDocStore } from "#/lib/pert/store";
import { cn } from "#/lib/utils";

// Renders a single staged AI proposal as an inline card under the assistant
// message that emitted it. The card stays in sync with proposalsStore: when
// the user applies a row, the store rebuilds the diff and the card refreshes;
// when the last row is consumed (or the user rejects), the proposal is
// evicted and the card collapses into a small "applied / rejected" stub.

export type ProposalCardProps = {
	proposalId: string;
};

export function ProposalCard({ proposalId }: ProposalCardProps) {
	const proposal = useStore(proposalsStore, (s) => s.byId[proposalId] ?? null);
	const changeDoc = useStore(projectDocStore, (s) => s.changeDoc);
	const handle = useStore(projectDocStore, (s) => s.handle);
	const activeProjectId = useStore(projectDocStore, (s) => s.projectId);
	// Route AI-applied changes through changeWith so they're tagged in the
	// History drawer with the "AI" badge. Falls back to the bare changeDoc
	// when the handle isn't available (read-only / non-collab paths) so the
	// proposal can still apply, just without source attribution.
	const aiChangeDoc = handle
		? (fn: (d: import("#/lib/pert/types").PertDoc) => void) =>
				changeWith(handle, "ai", fn)
		: changeDoc;

	if (!proposal) {
		// Either applied or rejected. Show a small acknowledging stub so the
		// chat history retains a marker of what happened.
		return (
			<div
				className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground"
				data-testid={`proposal-card-${proposalId}`}
				data-state="closed"
			>
				<span className="font-medium">Proposal closed</span>
				<span className="ml-1">— either applied or rejected.</span>
			</div>
		);
	}

	// A proposal staged for project A must never be applied while project B's
	// doc is active — that would import A's tasks into B. The card stays
	// visible (so the user understands what it is) but apply is disabled.
	const wrongProject =
		proposal.projectId !== null && proposal.projectId !== activeProjectId;

	const handleRow = (row: DiffRowKind) => {
		if (!aiChangeDoc || wrongProject) return;
		applyProposalRow(
			proposalId,
			row as Parameters<typeof applyProposalRow>[1],
			aiChangeDoc,
		);
	};

	const handleApplyAll = () => {
		if (!aiChangeDoc || wrongProject) return;
		applyProposal(proposalId, aiChangeDoc);
	};

	const handleReject = () => {
		rejectProposal(proposalId);
	};

	const readOnly = !changeDoc || wrongProject;
	const fails = proposal.results.filter((r) => !r.ok);

	return (
		<div
			className="overflow-hidden rounded-md border border-primary/30 bg-card"
			data-testid={`proposal-card-${proposalId}`}
			data-state="open"
		>
			<header className="flex flex-wrap items-start gap-2 border-b bg-primary/5 px-3 py-2">
				<div className="flex min-w-0 flex-1 items-start gap-2">
					<SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
					<div className="min-w-0 flex-1">
						<div className="text-[10px] font-medium uppercase tracking-wide text-primary">
							AI proposal
						</div>
						<p className="text-xs leading-snug">{proposal.rationale}</p>
					</div>
				</div>
				<DiffCountBadges counts={proposal.diff.counts} />
			</header>
			{wrongProject && (
				<div
					className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-700 dark:text-amber-300"
					data-testid={`proposal-wrong-project-${proposalId}`}
				>
					This proposal was staged for a different project. Open that project to
					apply it.
				</div>
			)}
			{fails.length > 0 && (
				<div className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
					<span className="font-medium">{fails.length}</span>{" "}
					{fails.length === 1 ? "operation" : "operations"} could not be staged
					and {fails.length === 1 ? "is" : "are"} excluded from the preview —
					see the operation list below.
				</div>
			)}
			<OperationsList
				proposalId={proposalId}
				operations={proposal.operations}
				results={proposal.results}
				// Auto-expand when something failed: that's exactly when the user
				// needs to see what the model attempted and why it was rejected.
				defaultOpen={fails.length > 0}
			/>
			<div className="max-h-[340px] overflow-hidden">
				<DiffBody
					before={proposal.currentSnapshot}
					after={proposal.proposedDoc}
					actionMode="apply"
					onRowAction={readOnly ? undefined : handleRow}
					emptyMessage="Nothing left to apply."
				/>
			</div>
			<footer className="flex items-center justify-end gap-1.5 border-t bg-card/40 px-3 py-2">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-7 gap-1 px-2 text-[11px]"
					onClick={handleReject}
					data-testid={`proposal-reject-${proposalId}`}
				>
					<XIcon className="size-3" /> Reject
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-7 gap-1 px-2 text-[11px]"
					onClick={handleApplyAll}
					disabled={readOnly || getProposal(proposalId) === null}
					data-testid={`proposal-apply-all-${proposalId}`}
				>
					<CheckCheckIcon className="size-3" /> Apply all
				</Button>
			</footer>
		</div>
	);
}

// The raw operations the model asked for, one row each, with staging status.
// The diff above only shows operations that staged successfully — without
// this list, a proposal whose operations all failed renders as "+0 ~0 −0 /
// Nothing left to apply" and gives no clue what the model attempted or why
// it was rejected.
function OperationsList({
	proposalId,
	operations,
	results,
	defaultOpen,
}: {
	proposalId: string;
	operations: EditOp[];
	results: Array<
		{ index: number; ok: true } | { index: number; ok: false; error: string }
	>;
	defaultOpen: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const failedCount = results.filter((r) => !r.ok).length;
	const resultByIndex = new Map(results.map((r) => [r.index, r]));
	return (
		<div
			className="border-b"
			data-testid={`proposal-operations-${proposalId}`}
			data-state={open ? "open" : "closed"}
		>
			<button
				type="button"
				className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-[10px] text-muted-foreground hover:bg-muted/30"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
			>
				{open ? (
					<ChevronDownIcon className="size-3 shrink-0" />
				) : (
					<ChevronRightIcon className="size-3 shrink-0" />
				)}
				<span className="font-medium">
					{operations.length}{" "}
					{operations.length === 1 ? "operation" : "operations"}
				</span>
				{failedCount > 0 && (
					<span className="text-destructive">· {failedCount} failed</span>
				)}
			</button>
			{open && (
				<ol className="space-y-1 px-3 pb-2 font-mono text-[10px]">
					{operations.map((op, i) => {
						const result = resultByIndex.get(i);
						const failed = result !== undefined && !result.ok;
						return (
							<li
								// Operations are immutable once staged — positional keys
								// can never be reordered out from under React.
								// biome-ignore lint/suspicious/noArrayIndexKey: see above.
								key={`${op.op}-${i}`}
								className="flex items-start gap-1.5"
								data-testid="proposal-operation-row"
								data-failed={failed ? "true" : "false"}
							>
								{failed ? (
									<XCircleIcon className="mt-0.5 size-3 shrink-0 text-destructive" />
								) : (
									<CheckIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
								)}
								<div className="min-w-0">
									<span
										className={cn("font-medium", failed && "text-destructive")}
									>
										{op.op}
									</span>{" "}
									<span className="break-all text-muted-foreground">
										{describeOp(op)}
									</span>
									{failed && (
										<div className="text-destructive">{result.error}</div>
									)}
								</div>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}

// Compact one-line rendering of an operation's payload (everything except the
// `op` discriminator), truncated so a 50-field add_task doesn't blow up the
// card.
function describeOp(op: EditOp): string {
	const { op: _discriminator, ...fields } = op as { op: string } & Record<
		string,
		unknown
	>;
	const text = JSON.stringify(fields);
	return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

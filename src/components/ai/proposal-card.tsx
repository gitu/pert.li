import { useStore } from "@tanstack/react-store";
import { CheckCheckIcon, SparklesIcon, XIcon } from "lucide-react";
import {
	DiffBody,
	DiffCountBadges,
	type DiffRowKind,
} from "#/components/pert/history/diff-body";
import { Button } from "#/components/ui/button";
import {
	applyProposal,
	applyProposalRow,
	getProposal,
	proposalsStore,
	rejectProposal,
} from "#/lib/ai/proposals-store";
import { projectDocStore } from "#/lib/pert/store";

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

	const handleRow = (row: DiffRowKind) => {
		if (!changeDoc) return;
		applyProposalRow(
			proposalId,
			row as Parameters<typeof applyProposalRow>[1],
			changeDoc,
		);
	};

	const handleApplyAll = () => {
		if (!changeDoc) return;
		applyProposal(proposalId, changeDoc);
	};

	const handleReject = () => {
		rejectProposal(proposalId);
	};

	const readOnly = !changeDoc;
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
			{fails.length > 0 && (
				<div className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
					<span className="font-medium">{fails.length}</span>{" "}
					{fails.length === 1 ? "operation" : "operations"} could not be staged
					and {fails.length === 1 ? "is" : "are"} excluded from the preview:{" "}
					{fails.map((f) => f.error).join("; ")}
				</div>
			)}
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

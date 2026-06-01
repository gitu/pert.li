import type { AnyDocumentId } from "@automerge/automerge-repo";
import { useDocHandle } from "@automerge/automerge-repo-react-hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftRightIcon, GitMergeIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Sheet, SheetContent } from "#/components/ui/sheet";
import { applyOperations } from "#/lib/ai/apply-operations";
import { mergeSelectionToOps } from "#/lib/ai/merge-to-ops";
import { changeWith } from "#/lib/pert/change-meta";
import { snapshotAt } from "#/lib/pert/history";
import {
	computeMerge,
	type MergeChange,
	type MergeSide,
} from "#/lib/pert/merge";
import type { PertDoc } from "#/lib/pert/types";
import { closeBranch } from "#/server/workspace";
import { MergeChangeList, rowKey } from "./merge-change-list";
import { MergeSummary } from "./merge-summary";

// Sheet that opens over the branch's canvas when the user clicks "Compare &
// merge" on the banner. Loads the parent project's doc into a second handle,
// snapshots it at the branch's fork heads, computes the 3-way diff, lets the
// user pick a resolution per row, and applies the accepted changes to main
// via the same EditOp pipeline the AI uses.

export type MergeDrawerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	branch: {
		projectId: string;
		title: string;
		doc: PertDoc;
		branchedFromHeads: string[];
	};
	parent: {
		projectId: string;
		title: string;
		automergeDocUrl: AnyDocumentId;
	};
};

export function MergeDrawer({
	open,
	onOpenChange,
	branch,
	parent,
}: MergeDrawerProps) {
	const parentHandle = useDocHandle<PertDoc>(parent.automergeDocUrl, {
		suspense: false,
	});
	const parentDoc = parentHandle?.doc() ?? null;

	const [direction, setDirection] = useState<
		"branch-to-main" | "main-to-branch"
	>("branch-to-main");
	const [resolutions, setResolutions] = useState<Record<string, MergeSide>>({});
	const [archiveBranch, setArchiveBranch] = useState(true);
	const [applyError, setApplyError] = useState<string | null>(null);

	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const merge = useMemo(() => {
		if (!parentDoc) return null;
		const base = snapshotAt(parentDoc, branch.branchedFromHeads);
		if (direction === "branch-to-main") {
			return computeMerge({ base, main: parentDoc, branch: branch.doc });
		}
		// Inverse direction: pull main's changes into the branch. Swap roles
		// — the "main" of the merge engine is now the branch, and vice versa.
		return computeMerge({ base, main: branch.doc, branch: parentDoc });
	}, [parentDoc, branch.branchedFromHeads, branch.doc, direction]);

	const archiveMutation = useMutation({
		mutationFn: () => closeBranch({ data: { projectId: branch.projectId } }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
	});

	const applyMutation = useMutation({
		mutationFn: async () => {
			if (!parentHandle || !merge) throw new Error("Parent not loaded");
			const selection = merge.changes.map((c) => {
				const key = rowKey(c);
				return {
					...c,
					resolution: resolutions[key] ?? c.suggestedSide,
				};
			});
			const ops = mergeSelectionToOps(selection);
			// Tag the merge as a system event so it shows up in History.
			const branchTitle = branch.title;
			changeWith(
				parentHandle,
				"system",
				(d) => {
					applyOperations(d, ops);
				},
				{
					kind: "merge-applied",
					payload: {
						branchProjectId: branch.projectId,
						branchTitle,
						appliedOps: ops.length,
					},
				},
			);
			return ops.length;
		},
		onSuccess: async (applied) => {
			if (archiveBranch && direction === "branch-to-main") {
				await archiveMutation.mutateAsync();
			}
			onOpenChange(false);
			if (direction === "branch-to-main") {
				navigate({
					to: "/p/$projectId",
					params: { projectId: parent.projectId },
				});
			}
			setApplyError(null);
			void applied;
		},
		onError: (err) =>
			setApplyError(err instanceof Error ? err.message : "Apply failed"),
	});

	const { fromTitle, toTitle } =
		direction === "branch-to-main"
			? { fromTitle: branch.title, toTitle: parent.title }
			: { fromTitle: parent.title, toTitle: branch.title };

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="flex w-[640px] flex-col p-0 sm:max-w-[80vw]"
				data-testid="merge-drawer"
			>
				<header className="flex shrink-0 items-center gap-2 border-b bg-card/40 px-3 py-2">
					<GitMergeIcon className="size-4 text-primary" />
					<div className="min-w-0 flex-1 text-xs">
						<div className="flex items-center gap-1.5 font-medium">
							<span className="truncate">{fromTitle}</span>
							<ArrowLeftRightIcon className="size-3 text-muted-foreground" />
							<span className="truncate">{toTitle}</span>
						</div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							{direction === "branch-to-main"
								? "Merging branch into main"
								: "Pulling main into branch"}
						</div>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 gap-1 px-2 text-[11px]"
						onClick={() =>
							setDirection((d) =>
								d === "branch-to-main" ? "main-to-branch" : "branch-to-main",
							)
						}
						data-testid="merge-direction-toggle"
					>
						<ArrowLeftRightIcon className="size-3" />
						Swap
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0"
						onClick={() => onOpenChange(false)}
						aria-label="Close"
					>
						<XIcon className="size-3.5" />
					</Button>
				</header>
				{!parentDoc && (
					<div className="grid h-full place-items-center p-6 text-xs text-muted-foreground">
						Loading {parent.title}…
					</div>
				)}
				{parentDoc && merge && (
					<>
						<MergeSummary
							clean={merge.counts.clean}
							conflict={merge.counts.conflict}
							skipped={countSkipped(merge.changes, resolutions)}
						/>
						<ScrollArea className="min-h-0 flex-1">
							<MergeChangeList
								changes={merge.changes}
								resolutions={resolutions}
								onResolutionChange={(k, s) =>
									setResolutions((prev) => ({ ...prev, [k]: s }))
								}
							/>
						</ScrollArea>
						<footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-card/40 px-3 py-2 text-xs">
							{direction === "branch-to-main" && (
								<label className="flex items-center gap-1.5 text-muted-foreground">
									<input
										type="checkbox"
										checked={archiveBranch}
										onChange={(e) => setArchiveBranch(e.target.checked)}
										className="size-3.5 accent-primary"
										data-testid="merge-archive-branch"
									/>
									Archive branch after merge
								</label>
							)}
							{applyError && (
								<span className="text-destructive" role="alert">
									{applyError}
								</span>
							)}
							<div className="ml-auto flex items-center gap-2">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => onOpenChange(false)}
									disabled={applyMutation.isPending}
								>
									Cancel
								</Button>
								<Button
									type="button"
									size="sm"
									onClick={() => applyMutation.mutate()}
									disabled={
										applyMutation.isPending ||
										countAccepted(merge.changes, resolutions) === 0
									}
									data-testid="merge-apply"
								>
									{applyMutation.isPending
										? "Applying…"
										: direction === "branch-to-main"
											? "Apply to main"
											: "Apply to branch"}
								</Button>
							</div>
						</footer>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}

function countSkipped(
	changes: MergeChange[],
	resolutions: Record<string, MergeSide>,
): number {
	let n = 0;
	for (const c of changes) {
		const r = resolutions[rowKey(c)] ?? c.suggestedSide;
		if (r === "skip") n += 1;
	}
	return n;
}

function countAccepted(
	changes: MergeChange[],
	resolutions: Record<string, MergeSide>,
): number {
	let n = 0;
	for (const c of changes) {
		const r = resolutions[rowKey(c)] ?? c.suggestedSide;
		if (r === "branch") n += 1;
	}
	return n;
}

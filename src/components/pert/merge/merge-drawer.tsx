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
import { mergeSelectionToOps, planMergeOps } from "#/lib/ai/merge-to-ops";
import { changeWith } from "#/lib/pert/change-meta";
import { snapshotAt } from "#/lib/pert/history";
import {
	computeMerge,
	type MergeChange,
	type MergeResult,
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

	const mergeResult = useMemo(() => {
		if (!parentDoc)
			return {
				merge: null as MergeResult | null,
				error: null as string | null,
			};
		try {
			const base = snapshotAt(parentDoc, branch.branchedFromHeads);
			const computed =
				direction === "branch-to-main"
					? computeMerge({ base, main: parentDoc, branch: branch.doc })
					: // Inverse direction: pull main's changes into the branch.
						// Swap roles — the "main" of the merge engine is now the branch.
						computeMerge({ base, main: branch.doc, branch: parentDoc });
			return { merge: computed, error: null };
		} catch (err) {
			// snapshotAt can throw if the stored fork-point heads are missing
			// or malformed on the parent (e.g. the parent doc was rebuilt from
			// a different storage). Surface as an error state instead of
			// crashing the whole drawer mid-render.
			return {
				merge: null,
				error:
					err instanceof Error
						? `Couldn't compute merge against the fork point: ${err.message}`
						: "Couldn't compute merge against the fork point.",
			};
		}
	}, [parentDoc, branch.branchedFromHeads, branch.doc, direction]);
	const merge = mergeResult.merge;
	const computeError = mergeResult.error;

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
			const liveDoc = parentHandle.doc();
			if (!liveDoc) throw new Error("Parent doc not available");
			// Sanitise the batch against the live doc: dropping a task on one
			// side leaves behind redundant remove_dependency ops (the task
			// removal already cascades them) and impossible add_dependency ops
			// (endpoint gone). planMergeOps filters those out so the dry-run
			// guard below only ever fires on genuine corruption.
			const { ops } = planMergeOps(mergeSelectionToOps(selection), liveDoc);
			// Archive-only path: a branch with no drift from main produces no
			// ops. Skip the dry-run + write entirely and fall through to
			// onSuccess, which archives the branch when requested.
			if (ops.length === 0) return 0;
			// Dry-run the ops on a deep clone of main first. If any fails we
			// abort before touching the real doc, so we never land a partial
			// merge or a misleading "merge-applied" marker.
			const probe = structuredClone(liveDoc) as PertDoc;
			const dryRun = applyOperations(probe, ops);
			const fails = dryRun.flatMap((r) =>
				r.ok ? [] : [`${r.op} (op #${r.index}): ${r.error}`],
			);
			if (fails.length > 0) {
				throw new Error(
					`Merge aborted — ${fails.length} of ${ops.length} ops failed: ${fails.join("; ")}`,
				);
			}
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
				{parentDoc && computeError && (
					<div
						className="grid h-full place-items-center p-6 text-center text-xs text-destructive"
						data-testid="merge-drawer-error"
					>
						<div className="max-w-sm space-y-2">
							<div>{computeError}</div>
							<div className="text-muted-foreground">
								Try reopening the branch or re-syncing the parent project.
							</div>
						</div>
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
								{(() => {
									const accepted = countAccepted(merge.changes, resolutions);
									// A clean branch (no accepted changes) can still be
									// archived: enable the button when archive is requested so
									// the merge flow doubles as the archive action.
									const archiveOnly =
										accepted === 0 &&
										archiveBranch &&
										direction === "branch-to-main";
									return (
										<Button
											type="button"
											size="sm"
											onClick={() => applyMutation.mutate()}
											disabled={
												applyMutation.isPending ||
												(accepted === 0 && !archiveOnly)
											}
											data-testid="merge-apply"
										>
											{applyMutation.isPending
												? "Applying…"
												: archiveOnly
													? "Archive branch"
													: direction === "branch-to-main"
														? "Apply to main"
														: "Apply to branch"}
										</Button>
									);
								})()}
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

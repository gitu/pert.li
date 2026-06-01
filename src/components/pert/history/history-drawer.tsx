import * as Automerge from "@automerge/automerge";
import { useStore } from "@tanstack/react-store";
import { ClockIcon, GitCompareIcon, HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { actorColor, shortActor } from "#/lib/pert/actor-format";
import {
	coalesceEntries,
	type HistoryGroup,
	readHistory,
	snapshotAt,
} from "#/lib/pert/history";
import { projectDocStore } from "#/lib/pert/store";
import type { PertDoc } from "#/lib/pert/types";
import { cn } from "#/lib/utils";
import { DiffPane } from "./diff-pane";

// Bottom-drawer history view. Reads commit metadata off the active project
// doc (lifted into projectDocStore by the project route), coalesces bursty
// edits, and lets the user pick a snapshot to compare against current.
//
// Two modes:
//   - default: pick one commit-group, compare it against current (restore
//     actions enabled)
//   - "compare two": pick two commit-groups (A then B); diff between them
//     renders read-only

type CompareMode = "history-vs-current" | "two-snapshots";

export function HistoryDrawer() {
	const doc = useStore(projectDocStore, (s) => s.doc);
	const changeDoc = useStore(projectDocStore, (s) => s.changeDoc);
	const projectId = useStore(projectDocStore, (s) => s.projectId);

	const [mode, setMode] = useState<CompareMode>("history-vs-current");
	const [selectedFirstIndex, setSelectedFirstIndex] = useState<number | null>(
		null,
	);
	const [secondFirstIndex, setSecondFirstIndex] = useState<number | null>(null);

	if (!doc || !changeDoc || !projectId) {
		return (
			<DrawerShell mode={mode} onModeChange={setMode}>
				<EmptyState>
					Open a project to browse history, compare versions, and restore
					earlier values.
				</EmptyState>
			</DrawerShell>
		);
	}

	return (
		<DrawerInner
			doc={doc}
			changeDoc={changeDoc}
			mode={mode}
			onModeChange={(next) => {
				setMode(next);
				setSelectedFirstIndex(null);
				setSecondFirstIndex(null);
			}}
			selectedFirstIndex={selectedFirstIndex}
			secondFirstIndex={secondFirstIndex}
			onSelect={(firstIndex) => {
				if (mode === "history-vs-current") {
					setSelectedFirstIndex(
						selectedFirstIndex === firstIndex ? null : firstIndex,
					);
					return;
				}
				// two-snapshots: first click sets A; second sets B; third resets A.
				if (selectedFirstIndex === null) {
					setSelectedFirstIndex(firstIndex);
					return;
				}
				if (selectedFirstIndex === firstIndex) {
					setSelectedFirstIndex(secondFirstIndex);
					setSecondFirstIndex(null);
					return;
				}
				if (secondFirstIndex === null) {
					setSecondFirstIndex(firstIndex);
					return;
				}
				if (secondFirstIndex === firstIndex) {
					setSecondFirstIndex(null);
					return;
				}
				// Third pick → reset to a fresh A.
				setSelectedFirstIndex(firstIndex);
				setSecondFirstIndex(null);
			}}
		/>
	);
}

function DrawerInner({
	doc,
	changeDoc,
	mode,
	onModeChange,
	selectedFirstIndex,
	secondFirstIndex,
	onSelect,
}: {
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	mode: CompareMode;
	onModeChange: (mode: CompareMode) => void;
	selectedFirstIndex: number | null;
	secondFirstIndex: number | null;
	onSelect: (firstIndex: number) => void;
}) {
	const groups = useMemo(() => {
		const entries = readHistory(doc);
		return coalesceEntries(entries).reverse(); // newest first
	}, [doc]);

	const selectedGroup = useMemo(() => {
		if (selectedFirstIndex === null) return null;
		return groups.find((g) => g.firstIndex === selectedFirstIndex) ?? null;
	}, [groups, selectedFirstIndex]);

	const secondGroup = useMemo(() => {
		if (secondFirstIndex === null) return null;
		return groups.find((g) => g.firstIndex === secondFirstIndex) ?? null;
	}, [groups, secondFirstIndex]);

	// Snapshot at the heads *before* the selected group — i.e. "what did the
	// doc look like right before this burst of edits?" That gives a diff that
	// reads as "what this commit-group changed."
	const baselineHeads = useMemo(
		() => baselineHeadsForGroup(doc, selectedGroup),
		[doc, selectedGroup],
	);

	const secondBaselineHeads = useMemo(
		() => baselineHeadsForGroup(doc, secondGroup),
		[doc, secondGroup],
	);

	const snapshot = useMemo(() => {
		if (!baselineHeads) return null;
		return snapshotAt(doc, baselineHeads);
	}, [doc, baselineHeads]);

	const secondSnapshot = useMemo(() => {
		if (!secondBaselineHeads) return null;
		return snapshotAt(doc, secondBaselineHeads);
	}, [doc, secondBaselineHeads]);

	// In two-snapshots mode we present "before(A) vs before(B)" so each side
	// reads as "the doc just before this commit-group" — consistent with the
	// single-snapshot mode which compares "before(group) vs current".
	const [beforeSnapshot, afterSnapshot, beforeGroup, afterGroup] = useMemo<
		[PertDoc | null, PertDoc | null, HistoryGroup | null, HistoryGroup | null]
	>(() => {
		if (mode !== "two-snapshots" || !selectedGroup || !secondGroup) {
			return [null, null, null, null];
		}
		if (!snapshot || !secondSnapshot) return [null, null, null, null];
		// Order so the older commit is "before" and the newer is "after".
		if (selectedGroup.firstIndex <= secondGroup.firstIndex) {
			return [snapshot, secondSnapshot, selectedGroup, secondGroup];
		}
		return [secondSnapshot, snapshot, secondGroup, selectedGroup];
	}, [mode, selectedGroup, secondGroup, snapshot, secondSnapshot]);

	const pickHint =
		mode === "two-snapshots"
			? selectedGroup
				? secondGroup
					? "Click another commit to swap A."
					: "Now pick a second commit (B)."
				: "Pick a first commit (A)."
			: undefined;

	return (
		<DrawerShell
			mode={mode}
			onModeChange={onModeChange}
			commitCount={groups.length}
		>
			<div className="grid h-full min-h-0 flex-1 grid-cols-[260px_1fr] divide-x divide-border">
				<ScrollArea className="h-full">
					{groups.length === 0 ? (
						<EmptyState>No edits yet.</EmptyState>
					) : (
						<ul className="space-y-px p-2">
							{groups.map((group, i) => {
								const selectionTag =
									mode === "two-snapshots"
										? group.firstIndex === selectedFirstIndex
											? "A"
											: group.firstIndex === secondFirstIndex
												? "B"
												: null
										: group.firstIndex === selectedFirstIndex
											? "•"
											: null;
								return (
									<li key={`${group.firstIndex}-${group.actor}`}>
										<HistoryRow
											group={group}
											isLatest={i === 0}
											selectionTag={selectionTag}
											onClick={() => onSelect(group.firstIndex)}
										/>
									</li>
								);
							})}
						</ul>
					)}
				</ScrollArea>
				<div className="flex h-full min-h-0 flex-col">
					{mode === "history-vs-current" && selectedGroup && snapshot && (
						<DiffPane
							mode="history-vs-current"
							snapshot={snapshot}
							current={doc}
							group={selectedGroup}
							onRestore={(mutate) => changeDoc(mutate)}
						/>
					)}
					{mode === "two-snapshots" &&
						beforeSnapshot &&
						afterSnapshot &&
						beforeGroup &&
						afterGroup && (
							<DiffPane
								mode="two-snapshots"
								beforeSnapshot={beforeSnapshot}
								afterSnapshot={afterSnapshot}
								beforeGroup={beforeGroup}
								afterGroup={afterGroup}
							/>
						)}
					{!hasDiff(mode, selectedGroup, secondGroup) && (
						<EmptyState>
							{groups.length === 0
								? "Make an edit on the canvas to see it land here."
								: (pickHint ??
									"Pick a commit on the left to see its diff against the current state.")}
						</EmptyState>
					)}
				</div>
			</div>
		</DrawerShell>
	);
}

function hasDiff(
	mode: CompareMode,
	selectedGroup: HistoryGroup | null,
	secondGroup: HistoryGroup | null,
): boolean {
	if (mode === "history-vs-current") return selectedGroup !== null;
	return selectedGroup !== null && secondGroup !== null;
}

function baselineHeadsForGroup(
	doc: PertDoc,
	group: HistoryGroup | null,
): string[] | null {
	if (!group) return null;
	const previousIndex = group.firstIndex - 1;
	if (previousIndex < 0) return [];
	const all = Automerge.getHistory(doc);
	const previous = all[previousIndex];
	return previous ? [previous.change.hash] : null;
}

function DrawerShell({
	mode,
	onModeChange,
	commitCount,
	children,
}: {
	mode: CompareMode;
	onModeChange: (mode: CompareMode) => void;
	commitCount?: number;
	children: React.ReactNode;
}) {
	const compareActive = mode === "two-snapshots";
	return (
		<div className="flex h-full flex-col" data-testid="history-drawer">
			<header className="flex shrink-0 items-center justify-between gap-3 border-b bg-card/40 px-4 py-2">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<HistoryIcon className="size-3.5" />
					History
				</div>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						size="sm"
						variant={compareActive ? "default" : "outline"}
						className="h-6 gap-1 px-2 text-[10px]"
						onClick={() =>
							onModeChange(
								compareActive ? "history-vs-current" : "two-snapshots",
							)
						}
						data-testid="history-toggle-compare-two"
						aria-pressed={compareActive}
					>
						<GitCompareIcon className="size-3" /> Compare two
					</Button>
					{commitCount !== undefined && (
						<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
							{commitCount} {commitCount === 1 ? "commit" : "commits"}
						</span>
					)}
				</div>
			</header>
			<div className="flex min-h-0 flex-1 flex-col">{children}</div>
		</div>
	);
}

function EmptyState({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
			<p className="max-w-sm">{children}</p>
		</div>
	);
}

function HistoryRow({
	group,
	isLatest,
	selectionTag,
	onClick,
}: {
	group: HistoryGroup;
	isLatest: boolean;
	selectionTag: "A" | "B" | "•" | null;
	onClick: () => void;
}) {
	const time = group.endTime ?? group.startTime;
	const isSelected = selectionTag !== null;
	return (
		<button
			type="button"
			onClick={onClick}
			data-testid={`history-row-${group.firstIndex}`}
			data-selected={isSelected}
			data-selection-tag={selectionTag ?? ""}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
				isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
			)}
		>
			<span
				className="block size-2 shrink-0 rounded-full"
				style={{ backgroundColor: actorColor(group.actor) }}
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="truncate font-medium">
						{group.message ?? (group.count > 1 ? "Edit burst" : "Edit")}
					</span>
					{isLatest && (
						<span className="rounded bg-primary/15 px-1 text-[9px] uppercase tracking-wide text-primary">
							latest
						</span>
					)}
					{selectionTag && selectionTag !== "•" && (
						<span className="rounded bg-primary px-1 text-[9px] font-medium uppercase tracking-wide text-primary-foreground">
							{selectionTag}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
					<ClockIcon className="size-3" />
					<span>{formatTime(time)}</span>
					<span aria-hidden>·</span>
					<span>
						{group.count} {group.count === 1 ? "edit" : "edits"}
					</span>
					<span aria-hidden>·</span>
					<span title={group.actor}>{shortActor(group.actor)}</span>
				</div>
			</div>
		</button>
	);
}

function formatTime(time: number | null): string {
	if (!time) return "unknown time";
	const ms = Date.now() - time;
	if (ms < 0) return "just now";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 14) return `${d}d ago`;
	return new Date(time).toLocaleString();
}

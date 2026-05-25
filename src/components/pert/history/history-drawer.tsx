import * as Automerge from "@automerge/automerge";
import { useStore } from "@tanstack/react-store";
import { ClockIcon, HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
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

export function HistoryDrawer() {
	const doc = useStore(projectDocStore, (s) => s.doc);
	const changeDoc = useStore(projectDocStore, (s) => s.changeDoc);
	const projectId = useStore(projectDocStore, (s) => s.projectId);

	const [selectedFirstIndex, setSelectedFirstIndex] = useState<number | null>(
		null,
	);

	if (!doc || !changeDoc || !projectId) {
		return (
			<DrawerShell>
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
			selectedFirstIndex={selectedFirstIndex}
			onSelect={setSelectedFirstIndex}
		/>
	);
}

function DrawerInner({
	doc,
	changeDoc,
	selectedFirstIndex,
	onSelect,
}: {
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
	selectedFirstIndex: number | null;
	onSelect: (firstIndex: number | null) => void;
}) {
	const groups = useMemo(() => {
		const entries = readHistory(doc);
		return coalesceEntries(entries).reverse(); // newest first
	}, [doc]);

	const selectedGroup = useMemo(() => {
		if (selectedFirstIndex === null) return null;
		return groups.find((g) => g.firstIndex === selectedFirstIndex) ?? null;
	}, [groups, selectedFirstIndex]);

	// Snapshot at the heads *before* the selected group — i.e. "what did the
	// doc look like right before this burst of edits?" That gives a diff that
	// reads as "what this commit-group changed."
	const baselineHeads = useMemo(() => {
		if (!selectedGroup) return null;
		const previousIndex = selectedGroup.firstIndex - 1;
		if (previousIndex < 0) return [];
		const all = Automerge.getHistory(doc);
		const previous = all[previousIndex];
		return previous ? [previous.change.hash] : null;
	}, [doc, selectedGroup]);

	const snapshot = useMemo(() => {
		if (!baselineHeads) return null;
		return snapshotAt(doc, baselineHeads);
	}, [doc, baselineHeads]);

	return (
		<DrawerShell
			right={
				<div className="flex items-center gap-2">
					<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
						{groups.length} {groups.length === 1 ? "commit" : "commits"}
					</span>
				</div>
			}
		>
			<div className="grid h-full min-h-0 flex-1 grid-cols-[260px_1fr] divide-x divide-border">
				<ScrollArea className="h-full">
					{groups.length === 0 ? (
						<EmptyState>No edits yet.</EmptyState>
					) : (
						<ul className="space-y-px p-2">
							{groups.map((group, i) => (
								<li key={`${group.firstIndex}-${group.actor}`}>
									<HistoryRow
										group={group}
										isLatest={i === 0}
										isSelected={selectedFirstIndex === group.firstIndex}
										onClick={() =>
											onSelect(
												selectedFirstIndex === group.firstIndex
													? null
													: group.firstIndex,
											)
										}
									/>
								</li>
							))}
						</ul>
					)}
				</ScrollArea>
				<div className="flex h-full min-h-0 flex-col">
					{selectedGroup && snapshot ? (
						<DiffPane
							snapshot={snapshot}
							current={doc}
							group={selectedGroup}
							onRestore={(mutate) => changeDoc(mutate)}
						/>
					) : (
						<EmptyState>
							{groups.length === 0
								? "Make an edit on the canvas to see it land here."
								: "Pick a commit on the left to see its diff against the current state."}
						</EmptyState>
					)}
				</div>
			</div>
		</DrawerShell>
	);
}

function DrawerShell({
	right,
	children,
}: {
	right?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="flex h-full flex-col" data-testid="history-drawer">
			<header className="flex shrink-0 items-center justify-between gap-3 border-b bg-card/40 px-4 py-2">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<HistoryIcon className="size-3.5" />
					History
				</div>
				{right}
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
	isSelected,
	onClick,
}: {
	group: HistoryGroup;
	isLatest: boolean;
	isSelected: boolean;
	onClick: () => void;
}) {
	const time = group.endTime ?? group.startTime;
	return (
		<button
			type="button"
			onClick={onClick}
			data-testid={`history-row-${group.firstIndex}`}
			data-selected={isSelected}
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

import { useMemo } from "react";
import { diffPertDoc } from "#/lib/pert/diff";
import type { HistoryGroup } from "#/lib/pert/history";
import {
	dropTaskMutation,
	reAddTaskMutation,
	restoreDependencyMutation,
	restoreTaskFieldMutation,
} from "#/lib/pert/restore";
import type { PertDoc } from "#/lib/pert/types";
import { DiffBody, DiffCountBadges, type DiffRowKind } from "./diff-body";

// History-flavoured shell around DiffBody. Two modes:
//   - "history-vs-current": pick a past commit-group, compare against current,
//     each row offers a Restore action that re-writes the current doc from
//     the snapshot using the restore.ts mutators.
//   - "two-snapshots": pick two past commit-groups; the body shows the delta
//     between them but no per-row actions (read-only retrospective view).

export type DiffPaneProps =
	| {
			mode: "history-vs-current";
			snapshot: PertDoc;
			current: PertDoc;
			group: HistoryGroup;
			onRestore: (mutate: (doc: PertDoc) => void) => void;
	  }
	| {
			mode: "two-snapshots";
			beforeSnapshot: PertDoc;
			afterSnapshot: PertDoc;
			beforeGroup: HistoryGroup;
			afterGroup: HistoryGroup;
	  };

export function DiffPane(props: DiffPaneProps) {
	if (props.mode === "history-vs-current") {
		return <HistoryVsCurrent {...props} />;
	}
	return <TwoSnapshots {...props} />;
}

function HistoryVsCurrent({
	snapshot,
	current,
	group,
	onRestore,
}: Extract<DiffPaneProps, { mode: "history-vs-current" }>) {
	const diff = useMemo(
		() => diffPertDoc(snapshot, current),
		[snapshot, current],
	);
	const handleRow = (row: DiffRowKind) => {
		if (row.type === "task-added") {
			onRestore(dropTaskMutation(row.taskId));
			return;
		}
		if (row.type === "task-removed") {
			const mut = reAddTaskMutation(snapshot, row.taskId);
			if (mut) onRestore(mut);
			return;
		}
		if (row.type === "task-field") {
			const mut = restoreTaskFieldMutation(snapshot, row.taskId, row.field);
			if (mut) onRestore(mut);
			return;
		}
		if (row.type === "dependency") {
			const mut = restoreDependencyMutation(snapshot, row.depId);
			if (mut) onRestore(mut);
		}
	};
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="diff-pane">
			<header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/20 px-3 py-2 text-xs">
				<span className="font-medium">
					Compared with snapshot before commit #{group.firstIndex + 1}
				</span>
				<DiffCountBadges counts={diff.counts} />
			</header>
			<DiffBody
				before={snapshot}
				after={current}
				actionMode="restore"
				onRowAction={handleRow}
			/>
		</div>
	);
}

function TwoSnapshots({
	beforeSnapshot,
	afterSnapshot,
	beforeGroup,
	afterGroup,
}: Extract<DiffPaneProps, { mode: "two-snapshots" }>) {
	const diff = useMemo(
		() => diffPertDoc(beforeSnapshot, afterSnapshot),
		[beforeSnapshot, afterSnapshot],
	);
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="diff-pane">
			<header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/20 px-3 py-2 text-xs">
				<span className="font-medium">
					Commit #{beforeGroup.firstIndex + 1} vs commit #
					{afterGroup.firstIndex + 1}
				</span>
				<DiffCountBadges counts={diff.counts} />
			</header>
			<DiffBody
				before={beforeSnapshot}
				after={afterSnapshot}
				actionMode="view"
			/>
		</div>
	);
}

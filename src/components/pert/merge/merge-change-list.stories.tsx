import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { MergeChange, MergeSide } from "#/lib/pert/merge";
import { MergeChangeList, rowKey } from "./merge-change-list";

function Controlled({ changes }: { changes: MergeChange[] }) {
	const [resolutions, setResolutions] = useState<Record<string, MergeSide>>({});
	return (
		<MergeChangeList
			changes={changes}
			resolutions={resolutions}
			onResolutionChange={(k, s) =>
				setResolutions((prev) => ({ ...prev, [k]: s }))
			}
		/>
	);
}

const meta: Meta<typeof MergeChangeList> = {
	title: "Pert / Merge / MergeChangeList",
	component: MergeChangeList,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof MergeChangeList>;

const cleanField: MergeChange = {
	kind: "field",
	entity: "task",
	id: "A",
	label: "Phase 1 — Discovery",
	field: "title",
	base: "Phase 1 — Discovery",
	main: "Phase 1 — Discovery",
	branch: "Phase 1 — Discovery (deep dive)",
	classification: "clean-from-branch",
	suggestedSide: "branch",
};

const cleanAdd: MergeChange = {
	kind: "entity",
	entity: "task",
	id: "C2",
	label: "Cross-functional sync",
	classification: "clean-add-from-branch",
	branchEntity: {
		id: "C2",
		kind: "task",
		title: "Cross-functional sync",
		parentId: null,
	},
	mainEntity: null,
	suggestedSide: "branch",
};

const conflictText: MergeChange = {
	kind: "field",
	entity: "task",
	id: "B",
	label: "Phase 2 — Build",
	field: "title",
	base: "Phase 2 — Build",
	main: "Phase 2 — Implementation (main rename)",
	branch: "Phase 2 — Build (branch rename)",
	classification: "conflict-modified",
	suggestedSide: "main",
};

const conflictRemovedVsModified: MergeChange = {
	kind: "entity",
	entity: "task",
	id: "D",
	label: "QA gate",
	classification: "conflict-removed-vs-modified",
	branchEntity: null,
	mainEntity: {
		id: "D",
		kind: "task",
		title: "QA gate (renamed by main)",
		parentId: null,
	},
	suggestedSide: "main",
};

export const Empty: Story = {
	render: () => <Controlled changes={[]} />,
};

export const Mixed: Story = {
	render: () => (
		<div className="w-[640px] border border-border bg-card">
			<Controlled
				changes={[
					cleanField,
					cleanAdd,
					conflictText,
					conflictRemovedVsModified,
				]}
			/>
		</div>
	),
};

export const OnlyConflicts: Story = {
	render: () => (
		<div className="w-[640px] border border-border bg-card">
			<Controlled
				changes={[
					conflictText,
					{
						...conflictText,
						id: "X",
						label: "Phase 3 — Rollout",
						field: "notes",
						base: null,
						main: "Soft launch",
						branch: "Hard launch",
					},
					conflictRemovedVsModified,
				]}
			/>
		</div>
	),
};

export const OnlyCleans: Story = {
	render: () => (
		<div className="w-[640px] border border-border bg-card">
			<Controlled
				changes={[
					cleanField,
					cleanAdd,
					{
						...cleanField,
						id: "B",
						label: "Phase 2",
						field: "notes",
						main: null,
						branch: "Notes added on branch",
					},
				]}
			/>
		</div>
	),
};

// rowKey is exported for tests / external integration; reference it so the
// story file isn't tree-shaken if Storybook only imports the default export.
export const _rowKey: Story = {
	parameters: { hidden: true },
	render: () => <span>{rowKey(cleanField)}</span>,
};

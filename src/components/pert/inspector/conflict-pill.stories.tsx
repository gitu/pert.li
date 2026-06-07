import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import type { TaskConflicts } from "#/lib/pert/conflicts";
import type { Estimate, PertDoc } from "#/lib/pert/types";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { ConflictPill } from "./conflict-pill";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

function seedDoc(): PertDoc {
	const d = createEmptyPertDoc("c");
	d.tasksById.T = {
		id: "T",
		kind: "task",
		title: "Original",
		estimate: est(1, 2, 4),
	};
	return d;
}

const estimateConflict: TaskConflicts = {
	taskId: "T",
	fields: [
		{
			field: "estimate",
			values: [
				{ opId: "op-a", value: est(2, 3, 5) },
				{ opId: "op-b", value: est(4, 6, 10) },
			],
		},
	],
};

const multiFieldConflict: TaskConflicts = {
	taskId: "T",
	fields: [
		{
			field: "title",
			values: [
				{ opId: "op-a", value: "Mine" },
				{ opId: "op-b", value: "Theirs" },
			],
		},
		{
			field: "notes",
			values: [
				{ opId: "op-a", value: "scratch" },
				{ opId: "op-b", value: "approved" },
			],
		},
	],
};

function Wrapper({ conflicts }: { conflicts: TaskConflicts }) {
	const [doc, setDoc] = useState(seedDoc());
	return (
		<div className="w-72 space-y-3 rounded-md border bg-card p-3">
			<ConflictPill
				conflicts={conflicts}
				taskId="T"
				onResolve={(mutate) =>
					setDoc((current) => {
						const draft = structuredClone(current) as PertDoc;
						mutate(draft);
						return draft;
					})
				}
			/>
			<pre className="overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-tight">
				{JSON.stringify(doc.tasksById.T, null, 2)}
			</pre>
		</div>
	);
}

const meta: Meta<typeof ConflictPill> = {
	title: "PERT/Inspector/ConflictPill",
	component: ConflictPill,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof ConflictPill>;

export const EstimateConflict: Story = {
	render: () => <Wrapper conflicts={estimateConflict} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const pill = await canvas.findByTestId("conflict-pill");
		expect(pill.textContent).toContain("estimate");
	},
};

export const TitleAndNotes: Story = {
	render: () => <Wrapper conflicts={multiFieldConflict} />,
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, within } from "storybook/test";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { MatrixMobile } from "./matrix-mobile";

const PROJECT_ID = "story-project";

function seedDoc(): PertDoc {
	const doc = createEmptyPertDoc("Phase 3 matrix-mobile story");
	for (const id of ["A", "B", "C", "D"]) {
		doc.tasksById[id] = {
			id,
			kind: "task",
			title: `Task ${id}`,
			estimate: { optimistic: 1, mostLikely: 2, pessimistic: 4, unit: "day" },
		};
	}
	// A → B, A → C, B → D, C → D — diamond
	const edges: Array<[string, string]> = [
		["A", "B"],
		["A", "C"],
		["B", "D"],
		["C", "D"],
	];
	edges.forEach(([from, to], i) => {
		doc.dependenciesById[`E${i}`] = {
			id: `E${i}`,
			from: { taskId: from },
			to: { taskId: to },
			type: "finish_to_start",
		};
	});
	return doc;
}

function Harness({ doc }: { doc: PertDoc }) {
	useEffect(() => {
		// biome-ignore lint/suspicious/noExplicitAny: story-only mock for changeDoc.
		setActiveProjectDoc(PROJECT_ID, doc, ((_d: unknown) => {}) as any, null);
		return () => clearActiveProjectDoc(PROJECT_ID);
	}, [doc]);
	return (
		<div className="h-[640px] w-[390px] overflow-hidden rounded-md border bg-background">
			<MatrixMobile projectId={PROJECT_ID} doc={doc} />
		</div>
	);
}

const meta: Meta<typeof MatrixMobile> = {
	title: "PERT/Mobile/MatrixMobile",
	component: MatrixMobile,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof MatrixMobile>;

export const Empty: Story = {
	render: () => <Harness doc={createEmptyPertDoc("Empty")} />,
};

export const Diamond: Story = {
	render: () => <Harness doc={seedDoc()} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const list = await canvas.findByTestId("matrix-mobile");
		expect(list.children).toHaveLength(4);
	},
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, within } from "storybook/test";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { TimelineMobile } from "./timeline-mobile";

const PROJECT_ID = "story-project";

function seedDoc(): PertDoc {
	const doc = createEmptyPertDoc("Phase 3 timeline-mobile story");
	for (let i = 0; i < 6; i++) {
		const id = `T${i}`;
		doc.tasksById[id] = {
			id,
			kind: "task",
			title: `Task ${i + 1}`,
			parentId: null,
			estimate: {
				optimistic: 1,
				mostLikely: 2 + i,
				pessimistic: 4 + i,
				unit: "day",
			},
		};
	}
	// Chain T0 -> T1 -> ... so they spread across multiple ISO weeks.
	for (let i = 1; i < 6; i++) {
		const id = `D${i}`;
		doc.dependenciesById[id] = {
			id,
			from: { taskId: `T${i - 1}` },
			to: { taskId: `T${i}` },
			type: "finish_to_start",
		};
	}
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
			<TimelineMobile projectId={PROJECT_ID} doc={doc} />
		</div>
	);
}

const meta: Meta<typeof TimelineMobile> = {
	title: "PERT/Mobile/TimelineMobile",
	component: TimelineMobile,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof TimelineMobile>;

export const Empty: Story = {
	render: () => <Harness doc={createEmptyPertDoc("Empty")} />,
};

export const ChainedTasks: Story = {
	render: () => <Harness doc={seedDoc()} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const list = await canvas.findByTestId("timeline-mobile");
		// Sticky week headers carry the "Week of …" copy.
		expect(list.textContent).toMatch(/week of/i);
	},
};

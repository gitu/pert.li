import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, within } from "storybook/test";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { TaskCardList } from "./task-card-list";

const PROJECT_ID = "story-project";

function seedDoc(taskCount: number): PertDoc {
	const doc = createEmptyPertDoc("Phase 3 card-list story");
	for (let i = 0; i < taskCount; i++) {
		const id = `T${i}`;
		doc.tasksById[id] = {
			id,
			kind: "task",
			title: `Task ${i + 1}`,
			estimate: {
				optimistic: 1,
				mostLikely: 2 + i,
				pessimistic: 4 + i * 2,
				unit: "day",
			},
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
			<TaskCardList projectId={PROJECT_ID} doc={doc} />
		</div>
	);
}

const meta: Meta<typeof TaskCardList> = {
	title: "PERT/Mobile/TaskCardList",
	component: TaskCardList,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof TaskCardList>;

export const Empty: Story = {
	render: () => <Harness doc={seedDoc(0)} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.queryByTestId("task-card-list"),
		).not.toBeInTheDocument();
		await expect(canvas.getByText(/no tasks yet/i)).toBeVisible();
	},
};

export const SmallProject: Story = {
	render: () => <Harness doc={seedDoc(5)} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const list = await canvas.findByTestId("task-card-list");
		expect(list.children).toHaveLength(5);
	},
};

export const LargeProject: Story = {
	render: () => <Harness doc={seedDoc(40)} />,
};

// Cards surface linked external issues as a compact badge. With a tracker
// template configured, the first key resolves to a click-through link.
export const WithIssueLinks: Story = {
	render: () => {
		const doc = seedDoc(3);
		doc.issueTracker = {
			urlTemplate: "https://acme.atlassian.net/browse/{key}",
			name: "Jira",
		};
		doc.tasksById.T0.issueKeys = ["PROJ-1", "PROJ-2"];
		doc.tasksById.T1.issueKeys = ["PROJ-9"];
		return <Harness doc={doc} />;
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const badges = await canvas.findAllByTestId("issue-link-badge");
		expect(badges).toHaveLength(2);
	},
};

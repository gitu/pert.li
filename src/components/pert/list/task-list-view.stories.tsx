import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
} from "#/lib/pert/types";
import { TaskListView } from "./task-list-view";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

const diamondDoc: PertDoc = (() => {
	const d = createEmptyPertDoc("Diamond demo");
	d.tasksById.A = {
		id: "A",
		kind: "task",
		title: "Design",
		parentId: null,
		estimate: est(1, 2, 3),
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Build API",
		parentId: null,
		estimate: est(2, 4, 6),
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Build UI",
		parentId: null,
		estimate: est(1, 6, 11),
	};
	d.tasksById.D = {
		id: "D",
		kind: "task",
		title: "Ship",
		parentId: null,
		estimate: est(1, 2, 3),
	};
	d.tasksById.M = {
		id: "M",
		kind: "milestone",
		title: "Beta cutoff",
		parentId: null,
	};
	d.dependenciesById.ab = {
		id: "ab",
		from: { taskId: "A" },
		to: { taskId: "B" },
		type: "finish_to_start",
	};
	d.dependenciesById.ac = {
		id: "ac",
		from: { taskId: "A" },
		to: { taskId: "C" },
		type: "finish_to_start",
	};
	d.dependenciesById.bd = {
		id: "bd",
		from: { taskId: "B" },
		to: { taskId: "D" },
		type: "finish_to_start",
	};
	d.dependenciesById.cd = {
		id: "cd",
		from: { taskId: "C" },
		to: { taskId: "D" },
		type: "finish_to_start",
	};
	return d;
})();

const emptyDoc = createEmptyPertDoc("New project");

function Stage({ doc, projectId }: { doc: PertDoc; projectId: string }) {
	return (
		<div className="h-[520px] w-full max-w-5xl overflow-hidden rounded-md border bg-background">
			<TaskListView projectId={projectId} doc={doc} />
		</div>
	);
}

const meta = {
	title: "PERT/TaskListView",
	component: Stage,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Diamond: Story = {
	args: { doc: diamondDoc, projectId: "story-diamond" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId("task-list-table")).toBeInTheDocument();
		// A, C, D are critical in the canonical fixture.
		const critical = canvas.getAllByText("critical");
		await expect(critical.length).toBe(3);
	},
};

export const Empty: Story = {
	args: { doc: emptyDoc, projectId: "story-empty" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("No tasks yet.")).toBeInTheDocument();
	},
};

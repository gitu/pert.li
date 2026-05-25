import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
} from "#/lib/pert/types";
import { TimelineView } from "./timeline-view";

const est = (o: number, m: number, p: number): Estimate => ({
	optimistic: o,
	mostLikely: m,
	pessimistic: p,
	unit: "day",
});

function diamondDoc(): PertDoc {
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
	d.dependenciesById.md = {
		id: "md",
		from: { taskId: "M" },
		to: { taskId: "D" },
		type: "finish_to_start",
	};
	return d;
}

function Stage({ doc, projectId }: { doc: PertDoc; projectId: string }) {
	return (
		<div className="h-[520px] w-full max-w-5xl overflow-hidden rounded-md border bg-background">
			<TimelineView projectId={projectId} doc={doc} />
		</div>
	);
}

const meta = {
	title: "PERT/TimelineView",
	component: Stage,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Diamond: Story = {
	args: { doc: diamondDoc(), projectId: "story-timeline-diamond" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId("timeline-svg")).toBeInTheDocument();
		await expect(canvas.getByTestId("timeline-lane-A")).toBeInTheDocument();
		await expect(canvas.getByTestId("timeline-lane-D")).toBeInTheDocument();
	},
};

export const Empty: Story = {
	args: { doc: createEmptyPertDoc("Empty"), projectId: "story-timeline-empty" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("No tasks yet.")).toBeInTheDocument();
	},
};

export const Cycle: Story = {
	args: {
		doc: (() => {
			const d = createEmptyPertDoc("Cycle");
			d.tasksById.A = {
				id: "A",
				kind: "task",
				title: "A",
				parentId: null,
				estimate: est(1, 1, 1),
			};
			d.tasksById.B = {
				id: "B",
				kind: "task",
				title: "B",
				parentId: null,
				estimate: est(1, 1, 1),
			};
			d.dependenciesById.ab = {
				id: "ab",
				from: { taskId: "A" },
				to: { taskId: "B" },
				type: "finish_to_start",
			};
			d.dependenciesById.ba = {
				id: "ba",
				from: { taskId: "B" },
				to: { taskId: "A" },
				type: "finish_to_start",
			};
			return d;
		})(),
		projectId: "story-timeline-cycle",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Cycle detected.")).toBeInTheDocument();
	},
};

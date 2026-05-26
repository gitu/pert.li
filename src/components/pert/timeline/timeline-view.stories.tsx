import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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

function keyedDoc(): PertDoc {
	const d = createEmptyPertDoc("Keyed phases");
	d.tasksById.a1 = {
		id: "a1",
		kind: "task",
		title: "Design API",
		parentId: null,
		key: "M1.API",
		estimate: est(1, 2, 3),
	};
	d.tasksById.a2 = {
		id: "a2",
		kind: "task",
		title: "Build API",
		parentId: null,
		key: "M1.API",
		estimate: est(2, 3, 5),
	};
	d.tasksById.b1 = {
		id: "b1",
		kind: "task",
		title: "Design UI",
		parentId: null,
		key: "M2.UI",
		estimate: est(1, 2, 3),
	};
	d.tasksById.b2 = {
		id: "b2",
		kind: "task",
		title: "Build UI",
		parentId: null,
		key: "M2.UI",
		estimate: est(2, 3, 5),
	};
	d.dependenciesById.d1 = {
		id: "d1",
		from: { taskId: "a1" },
		to: { taskId: "a2" },
		type: "finish_to_start",
	};
	d.dependenciesById.d2 = {
		id: "d2",
		from: { taskId: "b1" },
		to: { taskId: "b2" },
		type: "finish_to_start",
	};
	return d;
}

export const Grouped: Story = {
	args: { doc: keyedDoc(), projectId: "story-timeline-grouped" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const toggle = await canvas.findByTestId("timeline-group");
		// Off by default — no boundary markers, no key prefix.
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await userEvent.click(toggle);
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		// At least one lane should now be marked as a group boundary.
		const lanes = canvasElement.querySelectorAll(
			"[data-testid^='timeline-lane-'][data-group-boundary='true']",
		);
		await expect(lanes.length).toBeGreaterThan(0);
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

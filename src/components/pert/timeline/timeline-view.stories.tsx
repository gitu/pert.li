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
		estimate: est(1, 2, 3),
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Build API",
		estimate: est(2, 4, 6),
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Build UI",
		estimate: est(1, 6, 11),
	};
	d.tasksById.D = {
		id: "D",
		kind: "task",
		title: "Ship",
		estimate: est(1, 2, 3),
	};
	d.tasksById.M = {
		id: "M",
		kind: "milestone",
		title: "Beta cutoff",
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

// Long, evenly-paced project so the day axis stretches well past the
// container width — exercises the horizontal scroll + zoom controls.
function longLinearDoc(): PertDoc {
	const d = createEmptyPertDoc("Long linear");
	const days = 60;
	for (let i = 0; i < days; i++) {
		const id = `T${i}`;
		d.tasksById[id] = {
			id,
			kind: "task",
			title: `Task ${i + 1}`,
			estimate: est(1, 1, 1),
		};
		if (i > 0) {
			const depId = `d${i}`;
			d.dependenciesById[depId] = {
				id: depId,
				from: { taskId: `T${i - 1}` },
				to: { taskId: id },
				type: "finish_to_start",
			};
		}
	}
	return d;
}

export const Zoomable: Story = {
	args: { doc: longLinearDoc(), projectId: "story-timeline-zoom" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bars = await canvas.findByTestId("timeline-bars");
		// Auto-fit runs in a layout effect; wait for the resulting render so
		// the baseline width below isn't a stale default.
		await new Promise((r) => setTimeout(r, 0));
		const widthOf = (el: Element) => Number(el.getAttribute("width") ?? "0");
		const baseline = widthOf(bars);
		await expect(baseline).toBeGreaterThan(0);

		const zoomIn = await canvas.findByTestId("timeline-zoom-in");
		await userEvent.click(zoomIn);
		await userEvent.click(zoomIn);
		const zoomedIn = widthOf(canvas.getByTestId("timeline-bars"));
		await expect(zoomedIn).toBeGreaterThan(baseline);

		const zoomOut = await canvas.findByTestId("timeline-zoom-out");
		await userEvent.click(zoomOut);
		await userEvent.click(zoomOut);
		await userEvent.click(zoomOut);
		const zoomedOut = widthOf(canvas.getByTestId("timeline-bars"));
		await expect(zoomedOut).toBeLessThan(zoomedIn);

		const fit = await canvas.findByTestId("timeline-zoom-fit");
		await userEvent.click(fit);
		const fitted = widthOf(canvas.getByTestId("timeline-bars"));
		// "Fit" should land somewhere between the deeply-zoomed-out and
		// the heavily-zoomed-in widths — i.e. roughly the auto-fit baseline.
		await expect(fitted).toBeGreaterThan(zoomedOut);
		await expect(fitted).toBeLessThan(zoomedIn);
	},
};

function keyedDoc(): PertDoc {
	const d = createEmptyPertDoc("Grouped phases");
	// Two top-level groups (M1, M2), each with a nested sub-group (API, UI).
	// A task sits directly in the top-level group (m1 / m2) so the grouping
	// helper doesn't collapse the intermediate level away.
	d.groupsById.M1 = { id: "M1", name: "M1", parentGroupId: null, order: 0 };
	d.groupsById.API = { id: "API", name: "API", parentGroupId: "M1", order: 0 };
	d.groupsById.M2 = { id: "M2", name: "M2", parentGroupId: null, order: 1 };
	d.groupsById.UI = { id: "UI", name: "UI", parentGroupId: "M2", order: 0 };
	d.tasksById.m1 = {
		id: "m1",
		kind: "task",
		title: "M1 kickoff",
		groupId: "M1",
		estimate: est(1, 1, 1),
	};
	d.tasksById.a1 = {
		id: "a1",
		kind: "task",
		title: "Design API",
		groupId: "API",
		estimate: est(1, 2, 3),
	};
	d.tasksById.a2 = {
		id: "a2",
		kind: "task",
		title: "Build API",
		groupId: "API",
		estimate: est(2, 3, 5),
	};
	d.tasksById.m2 = {
		id: "m2",
		kind: "task",
		title: "M2 kickoff",
		groupId: "M2",
		estimate: est(1, 1, 1),
	};
	d.tasksById.b1 = {
		id: "b1",
		kind: "task",
		title: "Design UI",
		groupId: "UI",
		estimate: est(1, 2, 3),
	};
	d.tasksById.b2 = {
		id: "b2",
		kind: "task",
		title: "Build UI",
		groupId: "UI",
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
		// Off by default — no header rows in the SVG.
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await expect(
			canvasElement.querySelector("[data-testid^='timeline-header-']"),
		).toBeNull();
		await userEvent.click(toggle);
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		// Top-level groups (M1, M2) and their nested sub-groups (API, UI)
		// should all materialise as header rows. M1 / M2 are depth-0;
		// API / UI are depth-1.
		const headers = canvasElement.querySelectorAll(
			"[data-testid^='timeline-header-']",
		);
		await expect(headers.length).toBeGreaterThanOrEqual(4);
		await expect(
			canvasElement.querySelector("[data-depth='0']"),
		).not.toBeNull();
		await expect(
			canvasElement.querySelector("[data-depth='1']"),
		).not.toBeNull();
		// Lanes inside the second-level groups should be at depth 2.
		const deepLane = canvasElement.querySelector(
			"[data-testid='timeline-lane-a1'][data-depth='2']",
		);
		await expect(deepLane).not.toBeNull();
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
				estimate: est(1, 1, 1),
			};
			d.tasksById.B = {
				id: "B",
				kind: "task",
				title: "B",
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

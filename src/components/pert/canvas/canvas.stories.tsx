import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, within } from "storybook/test";
import { clearProjectCollapse, setCollapsed } from "#/lib/pert/collapse";
import { ensureContainerInterfaces } from "#/lib/pert/interfaces";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
} from "#/lib/pert/types";
import { PertCanvas } from "./canvas";

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
		layout: { position: { x: 40, y: 120 } },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Build API",
		parentId: null,
		estimate: est(2, 4, 6),
		layout: { position: { x: 320, y: 40 } },
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Build UI",
		parentId: null,
		estimate: est(1, 6, 11),
		layout: { position: { x: 320, y: 200 } },
	};
	d.tasksById.D = {
		id: "D",
		kind: "task",
		title: "Ship",
		parentId: null,
		estimate: est(1, 2, 3),
		layout: { position: { x: 600, y: 120 } },
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
}

function cycleDoc(): PertDoc {
	// Three-task cycle A → B → C → A. The CPM engine surfaces this with
	// `ok: false`, which lights up the banner and tints nodes/edges.
	const d = createEmptyPertDoc("Cycle demo");
	d.tasksById.A = {
		id: "A",
		kind: "task",
		title: "Design",
		parentId: null,
		estimate: est(1, 2, 3),
		layout: { position: { x: 60, y: 100 } },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Build",
		parentId: null,
		estimate: est(2, 4, 6),
		layout: { position: { x: 360, y: 100 } },
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Verify",
		parentId: null,
		estimate: est(1, 2, 3),
		layout: { position: { x: 200, y: 320 } },
	};
	d.dependenciesById.ab = {
		id: "ab",
		from: { taskId: "A" },
		to: { taskId: "B" },
		type: "finish_to_start",
	};
	d.dependenciesById.bc = {
		id: "bc",
		from: { taskId: "B" },
		to: { taskId: "C" },
		type: "finish_to_start",
	};
	d.dependenciesById.ca = {
		id: "ca",
		from: { taskId: "C" },
		to: { taskId: "A" },
		type: "finish_to_start",
	};
	return d;
}

function containerDoc(): PertDoc {
	const d = createEmptyPertDoc("Container demo");
	d.tasksById.start = {
		id: "start",
		kind: "milestone",
		title: "Kickoff",
		parentId: null,
		layout: { position: { x: 40, y: 160 } },
	};
	d.tasksById.box = {
		id: "box",
		kind: "container",
		title: "Backend slice",
		parentId: null,
	};
	d.tasksById["box-api"] = {
		id: "box-api",
		kind: "task",
		title: "REST endpoints",
		parentId: "box",
		estimate: est(2, 4, 8),
		layout: { position: { x: 280, y: 80 } },
	};
	d.tasksById["box-db"] = {
		id: "box-db",
		kind: "task",
		title: "Schema migration",
		parentId: "box",
		estimate: est(1, 3, 5),
		layout: { position: { x: 280, y: 220 } },
	};
	d.tasksById.ship = {
		id: "ship",
		kind: "task",
		title: "Ship",
		parentId: null,
		estimate: est(1, 2, 3),
		layout: { position: { x: 640, y: 160 } },
	};
	d.dependenciesById["start-api"] = {
		id: "start-api",
		from: { taskId: "start" },
		to: { taskId: "box-api" },
		type: "finish_to_start",
	};
	d.dependenciesById["start-db"] = {
		id: "start-db",
		from: { taskId: "start" },
		to: { taskId: "box-db" },
		type: "finish_to_start",
	};
	d.dependenciesById["api-db"] = {
		id: "api-db",
		from: { taskId: "box-db" },
		to: { taskId: "box-api" },
		type: "finish_to_start",
	};
	d.dependenciesById["api-ship"] = {
		id: "api-ship",
		from: { taskId: "box-api" },
		to: { taskId: "ship" },
		type: "finish_to_start",
	};
	ensureContainerInterfaces(d, "box");
	return d;
}

// Stand-in for the Automerge handle: keeps the doc in component state and
// applies mutate() against a structuredClone so referential equality flips
// the way the canvas expects. No sync, no persistence — Storybook only.
function Stage({
	seed,
	projectId,
	collapseOnMount,
}: {
	seed: PertDoc;
	projectId: string;
	collapseOnMount?: string[];
}) {
	const [doc, setDoc] = useState<PertDoc>(seed);

	useEffect(() => {
		clearProjectCollapse(projectId);
		for (const containerId of collapseOnMount ?? []) {
			setCollapsed(projectId, containerId, true);
		}
		return () => clearProjectCollapse(projectId);
	}, [projectId, collapseOnMount]);

	return (
		<div className="h-[560px] w-full max-w-5xl overflow-hidden rounded-md border bg-background">
			<PertCanvas
				projectId={projectId}
				doc={doc}
				changeDoc={(mutate) =>
					setDoc((current) => {
						const draft: PertDoc = structuredClone(current);
						mutate(draft);
						return draft;
					})
				}
			/>
		</div>
	);
}

const meta = {
	title: "PERT/Canvas",
	component: Stage,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
	args: {
		seed: createEmptyPertDoc("New project"),
		projectId: "story-canvas-empty",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("No tasks yet.")).toBeInTheDocument();
		await expect(canvas.getByTestId("canvas-toolbar")).toBeInTheDocument();
	},
};

export const Diamond: Story = {
	args: {
		seed: diamondDoc(),
		projectId: "story-canvas-diamond",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId("task-node-A")).toBeInTheDocument();
		await expect(canvas.getByTestId("task-node-D")).toBeInTheDocument();
		// A, C, D are critical in the canonical diamond fixture.
		const criticalLabels = canvas.getAllByText("critical");
		await expect(criticalLabels.length).toBeGreaterThanOrEqual(3);
	},
};

export const WithContainer: Story = {
	args: {
		seed: containerDoc(),
		projectId: "story-canvas-container",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("container-expanded-box"),
		).toBeInTheDocument();
		await expect(canvas.getByTestId("task-node-box-api")).toBeInTheDocument();
	},
};

export const ContainerCollapsed: Story = {
	args: {
		seed: containerDoc(),
		projectId: "story-canvas-container-collapsed",
		collapseOnMount: ["box"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("container-collapsed-box"),
		).toBeInTheDocument();
		// Descendants hidden, rollup card visible instead.
		await expect(canvas.queryByTestId("task-node-box-api")).toBeNull();
	},
};

function multiInterfaceContainerDoc(): PertDoc {
	const d = containerDoc();
	// Replace the default Entry/Exit pair with named fan-in/fan-out ports so
	// the port rail visibly stretches the card and labels show in the canvas.
	d.interfacesByContainerId.box = {
		if_design: {
			id: "if_design",
			containerId: "box",
			kind: "entry",
			label: "Design",
			taskRef: "box-api",
		},
		if_data: {
			id: "if_data",
			containerId: "box",
			kind: "entry",
			label: "Data",
			taskRef: "box-db",
		},
		if_api: {
			id: "if_api",
			containerId: "box",
			kind: "exit",
			label: "API ready",
			taskRef: "box-api",
		},
		if_runtime: {
			id: "if_runtime",
			containerId: "box",
			kind: "exit",
			label: "Runtime ready",
		},
	};
	return d;
}

export const ContainerCollapsedMultiInterface: Story = {
	args: {
		seed: multiInterfaceContainerDoc(),
		projectId: "story-canvas-container-multi-interface",
		collapseOnMount: ["box"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const card = await canvas.findByTestId("container-collapsed-box");
		await expect(card).toBeInTheDocument();
		await expect(within(card).getByText("Design")).toBeInTheDocument();
		await expect(within(card).getByText("API ready")).toBeInTheDocument();
	},
};

function legacyContainerDoc(): PertDoc {
	const d = containerDoc();
	// Simulate a pre-rework doc that never went through `ensureContainerInterfaces`.
	// The collapsed-card should still render with a single default handle per
	// side instead of failing to attach the rerouted edges.
	delete d.interfacesByContainerId.box;
	return d;
}

export const ContainerCollapsedLegacy: Story = {
	args: {
		seed: legacyContainerDoc(),
		projectId: "story-canvas-container-legacy",
		collapseOnMount: ["box"],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("container-collapsed-box"),
		).toBeInTheDocument();
	},
};

export const Cycle: Story = {
	args: {
		seed: cycleDoc(),
		projectId: "story-canvas-cycle",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// Banner renders, task nodes show "on cycle" instead of slack/critical.
		await expect(canvas.getByTestId("cycle-banner")).toBeInTheDocument();
		await expect(
			canvas.getByTestId("cycle-banner-autofix"),
		).toBeInTheDocument();
		const onCycleLabels = canvas.getAllByText("on cycle");
		await expect(onCycleLabels.length).toBe(3);
	},
};

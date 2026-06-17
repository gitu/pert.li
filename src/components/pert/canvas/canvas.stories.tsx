import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TooltipProvider } from "#/components/ui/tooltip";
import { clearProjectCollapse, setCollapsed } from "#/lib/pert/collapse";
import { selectionStore } from "#/lib/pert/store";
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
		estimate: est(1, 2, 3),
		layout: { position: { x: 40, y: 120 } },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Build API",
		estimate: est(2, 4, 6),
		layout: { position: { x: 320, y: 40 } },
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Build UI",
		estimate: est(1, 6, 11),
		layout: { position: { x: 320, y: 200 } },
	};
	d.tasksById.D = {
		id: "D",
		kind: "task",
		title: "Ship",
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
		estimate: est(1, 2, 3),
		layout: { position: { x: 60, y: 100 } },
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Build",
		estimate: est(2, 4, 6),
		layout: { position: { x: 360, y: 100 } },
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Verify",
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
	const d = createEmptyPertDoc("Group demo");
	d.groupsById.box = {
		id: "box",
		name: "Backend slice",
		parentGroupId: null,
		order: 0,
	};
	d.tasksById.start = {
		id: "start",
		kind: "milestone",
		title: "Kickoff",
		layout: { position: { x: 40, y: 160 } },
	};
	d.tasksById["box-api"] = {
		id: "box-api",
		kind: "task",
		title: "REST endpoints",
		groupId: "box",
		estimate: est(2, 4, 8),
		layout: { position: { x: 280, y: 80 } },
	};
	d.tasksById["box-db"] = {
		id: "box-db",
		kind: "task",
		title: "Schema migration",
		groupId: "box",
		estimate: est(1, 3, 5),
		layout: { position: { x: 280, y: 220 } },
	};
	d.tasksById.ship = {
		id: "ship",
		kind: "task",
		title: "Ship",
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
		<TooltipProvider delayDuration={150}>
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
		</TooltipProvider>
	);
}

const meta = {
	title: "PERT/Canvas",
	component: Stage,
	parameters: { layout: "padded" },
	// The xyflow + elkjs auto-layout re-positions the whole graph by a few
	// sub-pixels from one build to the next, so byte-level screenshot diffing
	// flags these stories on unrelated PRs (the baseline is always a different
	// build than the PR). Opt them out of the visual-regression diff — the
	// play functions below still run as functional tests in the storybook job.
	tags: ["no-screenshot-diff"],
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
		await expect(canvas.getByTestId("group-expanded-box")).toBeInTheDocument();
		await expect(canvas.getByTestId("task-node-box-api")).toBeInTheDocument();
	},
};

// Two-level nesting: outer group > inner group > leaf task. Z-ordering must
// go outer < inner < task so the inner frame/header stays visible and the
// task stays clickable inside both groups.
function nestedContainerDoc(): PertDoc {
	const d = createEmptyPertDoc("Nested groups demo");
	d.groupsById.outer = {
		id: "outer",
		name: "Outer group",
		parentGroupId: null,
		order: 0,
	};
	d.groupsById.inner = {
		id: "inner",
		name: "Inner group",
		parentGroupId: "outer",
		order: 0,
	};
	d.tasksById.deep = {
		id: "deep",
		kind: "task",
		title: "Deep task",
		groupId: "inner",
		estimate: est(1, 2, 4),
		layout: { position: { x: 320, y: 200 } },
	};
	return d;
}

// Reads the zIndex React Flow applied to the node wrapper containing the
// given testid element.
function nodeZIndex(canvasElement: HTMLElement, testId: string): number {
	const el = canvasElement.querySelector(`[data-testid="${testId}"]`);
	const wrapper = el?.closest(".react-flow__node") as HTMLElement | null;
	return wrapper ? Number(wrapper.style.zIndex || 0) : Number.NaN;
}

// Toolbar collapse-all / expand-all: every container folds to its summary
// card in one click, and unfolds again.
export const CollapseAllContainers: Story = {
	args: {
		seed: nestedContainerDoc(),
		projectId: "story-canvas-collapse-all",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("group-expanded-outer"),
		).toBeInTheDocument();
		// Collapse all → both containers render as collapsed cards. (The inner
		// one is inside a collapsed ancestor, so only the outer card remains
		// visible — the inner disappears from the projection.)
		await userEvent.click(canvas.getByTestId("toolbar-collapse-all"));
		await waitFor(async () => {
			await expect(
				canvas.getByTestId("group-collapsed-outer"),
			).toBeInTheDocument();
		});
		expect(canvas.queryByTestId("group-expanded-outer")).toBeNull();
		expect(canvas.queryByTestId("task-node-deep")).toBeNull();
		// Expand all → back to expanded frames with the deep task visible.
		await userEvent.click(canvas.getByTestId("toolbar-expand-all"));
		await waitFor(async () => {
			await expect(
				canvas.getByTestId("group-expanded-outer"),
			).toBeInTheDocument();
		});
		await expect(
			canvas.getByTestId("group-expanded-inner"),
		).toBeInTheDocument();
		await expect(canvas.getByTestId("task-node-deep")).toBeInTheDocument();
	},
};

export const NestedContainers: Story = {
	args: {
		seed: nestedContainerDoc(),
		projectId: "story-canvas-nested-containers",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("group-expanded-outer"),
		).toBeInTheDocument();
		await expect(
			canvas.getByTestId("group-expanded-inner"),
		).toBeInTheDocument();
		await expect(canvas.getByTestId("task-node-deep")).toBeInTheDocument();
		// Z-ordering: outer group < inner group < leaf task.
		const outerZ = nodeZIndex(canvasElement, "group-expanded-outer");
		const innerZ = nodeZIndex(canvasElement, "group-expanded-inner");
		const taskZ = nodeZIndex(canvasElement, "task-node-deep");
		expect(outerZ).toBeLessThan(innerZ);
		expect(innerZ).toBeLessThan(taskZ);
		// The deep task is still clickable (nothing covers it): clicking selects.
		await userEvent.click(canvas.getByTestId("task-node-deep"));
		await waitFor(() => {
			const selected = canvasElement.querySelector(
				'.react-flow__node.selected [data-testid="task-node-deep"]',
			);
			expect(selected).not.toBeNull();
		});
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
		await expect(canvas.getByTestId("group-collapsed-box")).toBeInTheDocument();
		// Descendants hidden, rollup card visible instead.
		await expect(canvas.queryByTestId("task-node-box-api")).toBeNull();
	},
};

// Arrow-key navigation must (a) jump the selection through the dep graph and
// (b) NOT shift the underlying React Flow node — React Flow's a11y handler
// nudges focused nodes a few pixels on every arrow press unless our window
// listener intercepts in the capture phase with stopPropagation.
export const ArrowKeyNavigation: Story = {
	args: {
		seed: diamondDoc(),
		projectId: "story-canvas-keynav",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const nodeA = await canvas.findByTestId("task-node-A");

		// Walk up to the React Flow node wrapper so we can read the
		// transform that React Flow writes for positioning. Moving the
		// node changes this transform; navigating doesn't.
		const wrapperA = nodeA.closest(".react-flow__node") as HTMLElement;
		await expect(wrapperA).not.toBeNull();
		const before = wrapperA.style.transform;

		await userEvent.click(nodeA);
		await waitFor(() => expect(selectionStore.state.taskId).toBe("A"));
		// Mouse click already sets the React Flow `selected` class, but assert
		// it so the keynav-driven assertions below have a clear baseline.
		await waitFor(() =>
			expect(wrapperA.classList.contains("selected")).toBe(true),
		);

		await userEvent.keyboard("{ArrowRight}");
		// Diamond: A → {B, C}. closestByY tie-breaks on iteration order
		// (ab before ac) so B wins.
		await waitFor(() => expect(selectionStore.state.taskId).toBe("B"));
		// A's React Flow node must not have been nudged by the arrow key.
		await expect(wrapperA.style.transform).toBe(before);
		// Visual selection must follow keynav too — React Flow tracks node
		// selection in its own local state, so updating selectionStore alone
		// leaves the ring on whatever was last clicked.
		const wrapperB = canvas
			.getByTestId("task-node-B")
			.closest(".react-flow__node") as HTMLElement;
		await waitFor(() => {
			expect(wrapperB.classList.contains("selected")).toBe(true);
			expect(wrapperA.classList.contains("selected")).toBe(false);
		});

		// Bouncing off the right edge: D has no successor. The selection
		// stays put AND the node still doesn't move.
		await userEvent.keyboard("{ArrowRight}");
		await waitFor(() => expect(selectionStore.state.taskId).toBe("D"));
		const nodeD = canvas.getByTestId("task-node-D");
		const wrapperD = nodeD.closest(".react-flow__node") as HTMLElement;
		const dBefore = wrapperD.style.transform;
		await waitFor(() =>
			expect(wrapperD.classList.contains("selected")).toBe(true),
		);
		await userEvent.keyboard("{ArrowRight}");
		await expect(selectionStore.state.taskId).toBe("D");
		await expect(wrapperD.style.transform).toBe(dBefore);
	},
};

// Send a raw keydown straight at the window so we exercise the canvas's
// capture-phase listener without fighting userEvent's special-cased Tab /
// focus-traversal behaviour. Used by the keyboard-add tests below; clicks
// are still real userEvent clicks so selection-store updates fire normally.
function dispatchKey(init: {
	key: string;
	shiftKey?: boolean;
	metaKey?: boolean;
}): void {
	const event = new KeyboardEvent("keydown", {
		key: init.key,
		shiftKey: init.shiftKey ?? false,
		metaKey: init.metaKey ?? false,
		bubbles: true,
		cancelable: true,
	});
	window.dispatchEvent(event);
}

function countTaskNodes(root: HTMLElement): number {
	return root.querySelectorAll("[data-testid^='task-node-']").length;
}

// Plain-letter add: a keydown for `n` triggers the canvas-level handler and
// creates a fresh task at the viewport centre — validates the listener fires
// even when no node is selected and the doc is empty. We count task-node
// data-testid elements (not the rendered title) because newly added nodes
// land in inline-edit mode where the title lives inside an <input>, not a
// text node — getByText would never find it.
export const PlainLetterAdd: Story = {
	args: {
		seed: createEmptyPertDoc("Keyboard add"),
		projectId: "story-canvas-plain-add",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("No tasks yet.")).toBeInTheDocument();
		dispatchKey({ key: "n" });
		await waitFor(() => expect(countTaskNodes(canvasElement)).toBe(1));
		// Inline-edit form opened on the freshly added task.
		await expect(canvas.getByTestId("task-inline-title")).toBeInTheDocument();
		// `m` adds a milestone alongside the new task.
		dispatchKey({ key: "m" });
		await waitFor(() => expect(countTaskNodes(canvasElement)).toBe(2));
	},
};

// Tab-spawn from selection: select a node, dispatch a Tab keydown, expect a
// new linked downstream task. Shift+Tab dispatches a Shift+Tab keydown and
// adds a sibling sharing the seed's predecessors. We bypass userEvent
// because it intercepts Tab as a focus-traversal command instead of firing
// a keydown.
export const TabSpawnAndSibling: Story = {
	args: {
		seed: diamondDoc(),
		projectId: "story-canvas-tab-spawn",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const nodeA = await canvas.findByTestId("task-node-A");
		await userEvent.click(nodeA);
		await waitFor(() => expect(selectionStore.state.taskId).toBe("A"));

		const before = countTaskNodes(canvasElement);

		dispatchKey({ key: "Tab" });
		await waitFor(() => expect(countTaskNodes(canvasElement)).toBe(before + 1));
		// Inline-edit form opened on the new node.
		await waitFor(() =>
			expect(canvas.getByTestId("task-inline-title")).toBeInTheDocument(),
		);
		// Commit the inline edit (Enter on the focused title input). After this
		// the selection still points at the new task — we reset it directly via
		// the store instead of clicking A again, because clicking through an
		// inline-edit blur/commit cycle is racy and the click handler is
		// already covered by the ArrowKeyNavigation story.
		await userEvent.keyboard("{Enter}");
		selectionStore.setState((s) => ({
			...s,
			projectId: "story-canvas-tab-spawn",
			taskId: "A",
			groupId: null,
		}));

		dispatchKey({ key: "Tab", shiftKey: true });
		await waitFor(() => expect(countTaskNodes(canvasElement)).toBe(before + 2));
	},
};

// Keyboard help popover surfaces every binding the canvas accepts. Test
// that opening it reveals the section headings — full row-by-row coverage
// would just mirror the constant defined in keyboard-shortcuts-help.tsx.
export const KeyboardHelpPopover: Story = {
	args: {
		seed: diamondDoc(),
		projectId: "story-canvas-help",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const helpButton = await canvas.findByTestId("canvas-keyboard-help");
		await userEvent.click(helpButton);
		// Popover content is portaled — search at the document body level.
		await waitFor(() => {
			const body = within(document.body);
			expect(body.getByText("Add")).toBeInTheDocument();
			expect(body.getByText("Navigate")).toBeInTheDocument();
			expect(body.getByText(/Spawn downstream task/i)).toBeInTheDocument();
		});
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

// PARALLEL-STAFFING (end-to-end through the real builder): a doc with staffing
// enabled, the canvas display field on, and a big task renders the ⚡N→Xd badge
// while leaving the duration label untouched. Exercises buildBaseNodes →
// pushLeafNode → TaskNode.
function staffingDoc(): PertDoc {
	const d = createEmptyPertDoc("Staffing demo");
	d.tasksById.BIG = {
		id: "BIG",
		kind: "task",
		title: "Migrate database",
		estimate: est(18, 20, 24), // expected ≈ 20.3 d
		layout: { position: { x: 120, y: 120 } },
	};
	d.scheduling = {
		parallelStaffing: { enabled: true, levelDays: 5, maxPerTask: 4 },
	};
	d.display = { canvas: { fields: { staffing: true } } };
	return d;
}

export const ParallelStaffingBadge: Story = {
	args: {
		seed: staffingDoc(),
		projectId: "story-canvas-staffing",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Migrate database");
		// The PERT duration (~20 d) is shown untouched…
		await expect(await canvas.findByText(/20(\.\d+)? d/)).toBeInTheDocument();
		// …and the staffing badge renders as a separate ⚡ segment (4 people).
		await expect(await canvas.findByText(/⚡4/)).toBeInTheDocument();
	},
};

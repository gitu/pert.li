import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
	clearActiveProjectDoc,
	selectionStore,
	setActiveProjectDoc,
} from "#/lib/pert/store";
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
	return d;
})();

const emptyDoc = createEmptyPertDoc("New project");

// Two real groups plus an ungrouped task, so the table renders both real
// group headers (selectable / renamable) and the synthetic "(ungrouped)"
// node (inert) when "Group" is toggled on. The factory below clones a fresh
// copy per story so the inline-rename / selection plays don't leak state.
function makeGroupedDoc(): PertDoc {
	const d = createEmptyPertDoc("Grouped demo");
	d.groupsById.g1 = {
		id: "g1",
		name: "Design phase",
		parentGroupId: null,
		order: 0,
	};
	d.groupsById.g2 = {
		id: "g2",
		name: "Build phase",
		parentGroupId: null,
		order: 1,
	};
	d.tasksById.A = {
		id: "A",
		kind: "task",
		title: "Wireframes",
		estimate: est(1, 2, 3),
		groupId: "g1",
		order: 0,
	};
	d.tasksById.B = {
		id: "B",
		kind: "task",
		title: "Build API",
		estimate: est(2, 4, 6),
		groupId: "g2",
		order: 0,
	};
	d.tasksById.C = {
		id: "C",
		kind: "task",
		title: "Loose end",
		estimate: est(1, 1, 2),
	};
	return d;
}

// Read-only stage: renders the list without wiring the projectDocStore, so
// the quick-add row and inline edits stay hidden. Mirrors the mobile
// read-only mode and the marketing demo cases.
function Stage({ doc, projectId }: { doc: PertDoc; projectId: string }) {
	return (
		<div className="h-[520px] w-full max-w-5xl overflow-hidden rounded-md border bg-background">
			<TaskListView projectId={projectId} doc={doc} />
		</div>
	);
}

// Editable stage: wires the projectDocStore so the quick-add row, inline
// edits, and keyboard shortcuts (insert / indent / Shift+Enter milestone)
// are all live. Local state stands in for the Automerge doc handle.
function EditableStage({
	seed,
	projectId,
}: {
	seed: PertDoc;
	projectId: string;
}) {
	const [doc, setDoc] = useState<PertDoc>(seed);

	useEffect(() => {
		setActiveProjectDoc(
			projectId,
			doc,
			(mutate) => {
				setDoc((current) => {
					const draft: PertDoc = structuredClone(current);
					mutate(draft);
					return draft;
				});
			},
			null,
		);
		return () => clearActiveProjectDoc(projectId);
	}, [projectId, doc]);

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

// Static visual state of the grouped table (no play). Renders the editable
// grouped fixture so the group headers — selectable / double-click-to-rename,
// with the synthetic "(ungrouped)" bucket — are visible at a glance. Toggle
// "Group" in the toolbar to see the nesting.
export const Grouped: Story = {
	args: { doc: emptyDoc, projectId: "story-grouped" },
	render: (args) => (
		<EditableStage seed={makeGroupedDoc()} projectId={args.projectId} />
	),
};

export const Empty: Story = {
	args: { doc: emptyDoc, projectId: "story-empty" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("No tasks yet.")).toBeInTheDocument();
	},
};

// `o` inserts a new task below the selected row, with a `selected → new`
// dep so it sorts immediately after. Inline-edit opens on the new row so the
// user can type the title right away — we assert the editor surfaces (focus
// races into the title input are checked end-to-end by Playwright).
export const KeyboardInsertBelow: Story = {
	args: { doc: diamondDoc, projectId: "story-list-insert" },
	render: (args) => (
		<EditableStage seed={args.doc} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const rowA = await canvas.findByTestId("task-list-row-A");
		const rowCountBefore = canvasElement.querySelectorAll(
			'[data-testid^="task-list-row-"]',
		).length;
		await userEvent.click(rowA);
		await waitFor(() => expect(selectionStore.state.taskId).toBe("A"));

		await userEvent.keyboard("o");
		// One new row + one editing title input show up.
		await waitFor(() =>
			expect(canvas.getByTestId("task-list-title-input")).toBeInTheDocument(),
		);
		await waitFor(() => {
			const rowCountAfter = canvasElement.querySelectorAll(
				'[data-testid^="task-list-row-"]',
			).length;
			expect(rowCountAfter).toBe(rowCountBefore + 1);
		});
	},
};

// Shift+Enter inside the quick-add title commits as a milestone instead of
// a task. The milestone has no estimate, only a title.
export const KeyboardQuickAddMilestone: Story = {
	args: { doc: emptyDoc, projectId: "story-list-quickadd-milestone" },
	render: (args) => (
		<EditableStage seed={args.doc} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = await canvas.findByTestId("task-list-quick-add-title");
		await userEvent.click(input);
		await userEvent.keyboard("Beta cutoff");
		await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
		await waitFor(() =>
			expect(canvas.getByText("Beta cutoff")).toBeInTheDocument(),
		);
		// `kind` cell on the new row should say "milestone".
		await waitFor(() => {
			const milestones = canvas.queryAllByText("milestone");
			expect(milestones.length).toBeGreaterThan(0);
		});
	},
};

// Double-clicking a group name in the grouped table opens an inline editor;
// Enter commits the rename through renameGroupMutation. Mirrors how a task
// title is renamed, which groups previously couldn't do at all in the table.
export const GroupRename: Story = {
	args: { doc: emptyDoc, projectId: "story-group-rename" },
	render: (args) => (
		<EditableStage seed={makeGroupedDoc()} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("task-list-group"));
		const label = await canvas.findByTestId("task-list-group-label-g1");
		await expect(label).toHaveTextContent("Design phase");
		await userEvent.dblClick(label);
		const input = await canvas.findByTestId("task-list-group-name-input");
		await userEvent.clear(input);
		await userEvent.type(input, "Discovery{Enter}");
		await waitFor(() =>
			expect(
				canvas.queryByTestId("task-list-group-name-input"),
			).not.toBeInTheDocument(),
		);
		await waitFor(() =>
			expect(canvas.getByTestId("task-list-group-label-g1")).toHaveTextContent(
				"Discovery",
			),
		);
	},
};

// Escape during a group rename discards the edit — guards the blur-commit
// race where unmounting the input would otherwise commit on the way out.
export const GroupRenameEscape: Story = {
	args: { doc: emptyDoc, projectId: "story-group-rename-escape" },
	render: (args) => (
		<EditableStage seed={makeGroupedDoc()} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("task-list-group"));
		await userEvent.dblClick(
			await canvas.findByTestId("task-list-group-label-g1"),
		);
		const input = await canvas.findByTestId("task-list-group-name-input");
		await userEvent.clear(input);
		await userEvent.type(input, "Throwaway{Escape}");
		await waitFor(() =>
			expect(
				canvas.queryByTestId("task-list-group-name-input"),
			).not.toBeInTheDocument(),
		);
		// Name is unchanged — Escape cancelled, blur didn't sneak a commit in.
		await expect(
			canvas.getByTestId("task-list-group-label-g1"),
		).toHaveTextContent("Design phase");
	},
};

// Single-clicking a group name selects the group (opens the inspector) and
// highlights the header row. The synthetic "(ungrouped)" node stays inert.
export const GroupSelect: Story = {
	args: { doc: emptyDoc, projectId: "story-group-select" },
	render: (args) => (
		<EditableStage seed={makeGroupedDoc()} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("task-list-group"));
		await userEvent.click(
			await canvas.findByTestId("task-list-group-label-g2"),
		);
		await waitFor(() => expect(selectionStore.state.groupId).toBe("g2"));
		await waitFor(() =>
			expect(canvas.getByTestId("task-list-group-g2")).toHaveAttribute(
				"data-selected",
				"true",
			),
		);
		// The ungrouped bucket can't be selected — its label button is disabled.
		await expect(
			canvas.getByTestId("task-list-group-label-__ungrouped__"),
		).toBeDisabled();
	},
};

// Clicking the chevron / metadata area still collapses the group — the new
// name affordance must not have stolen the toggle.
export const GroupCollapseStillWorks: Story = {
	args: { doc: emptyDoc, projectId: "story-group-collapse" },
	render: (args) => (
		<EditableStage seed={makeGroupedDoc()} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("task-list-group"));
		await expect(await canvas.findByTestId("task-list-row-A")).toBeVisible();
		// Click the header cell itself (not the name button) to toggle collapse.
		// The collapse handler lives on the <td>, so target it directly.
		const headerCell = canvas
			.getByTestId("task-list-group-g1")
			.querySelector("td");
		if (!headerCell) throw new Error("group header cell not found");
		await userEvent.click(headerCell);
		await waitFor(() =>
			expect(canvas.queryByTestId("task-list-row-A")).not.toBeInTheDocument(),
		);
	},
};

// In "Edit all" mode every group name becomes an always-on input (like task
// cells), and the one-shot blur guard re-arms on each keystroke — so an Enter
// commit followed by more typing + blur still commits the later value.
export const GroupEditAllRename: Story = {
	args: { doc: emptyDoc, projectId: "story-group-edit-all" },
	render: (args) => (
		<EditableStage seed={makeGroupedDoc()} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("task-list-group"));
		await userEvent.click(await canvas.findByTestId("task-list-edit-all"));
		// Group g1's header row now carries a live name input (no double-click).
		const g1Row = await canvas.findByTestId("task-list-group-g1");
		const input = within(g1Row).getByTestId("task-list-group-name-input");
		await userEvent.clear(input);
		await userEvent.type(input, "Phase One{Enter}");
		// Re-arm check: keep typing after Enter, then commit again via blur.
		await userEvent.type(input, " (rev)");
		await userEvent.tab();
		// Exit edit-all so the header renders as a label again, proving the
		// later (post-Enter) value actually reached the doc.
		await userEvent.click(canvas.getByTestId("task-list-edit-all"));
		await waitFor(() =>
			expect(canvas.getByTestId("task-list-group-label-g1")).toHaveTextContent(
				"Phase One (rev)",
			),
		);
	},
};

// Keyboard help popover surfaces the table-specific cheat-sheet. We assert
// the section headings and a few flagship rows.
export const KeyboardHelpPopover: Story = {
	args: { doc: diamondDoc, projectId: "story-list-help" },
	render: (args) => (
		<EditableStage seed={args.doc} projectId={args.projectId} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const helpButton = await canvas.findByTestId("task-list-keyboard-help");
		await userEvent.click(helpButton);
		await waitFor(() => {
			const body = within(document.body);
			expect(
				body.getByText("Join the previous row's group"),
			).toBeInTheDocument();
			expect(
				body.getByText(/Insert a task below the selected row/i),
			).toBeInTheDocument();
		});
	},
};

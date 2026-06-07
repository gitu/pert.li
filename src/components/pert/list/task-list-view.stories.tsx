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

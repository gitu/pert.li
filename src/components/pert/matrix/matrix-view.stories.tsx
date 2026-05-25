import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, within } from "storybook/test";
import { clearActiveProjectDoc, setActiveProjectDoc } from "#/lib/pert/store";
import {
	createEmptyPertDoc,
	type Estimate,
	type PertDoc,
} from "#/lib/pert/types";
import { MatrixView } from "./matrix-view";

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

// The matrix reads `changeDoc` from `projectDocStore` so the project route's
// lift-up keeps working in production. In Storybook, we lift a local
// `useState` doc through the same store, mimicking the real wiring.
function Stage({ seed, projectId }: { seed: PertDoc; projectId: string }) {
	const [doc, setDoc] = useState<PertDoc>(seed);

	useEffect(() => {
		const changeDoc = (mutate: (d: PertDoc) => void) =>
			setDoc((current) => {
				const draft: PertDoc = structuredClone(current);
				mutate(draft);
				return draft;
			});
		setActiveProjectDoc(projectId, doc, changeDoc, null);
		return () => clearActiveProjectDoc(projectId);
	}, [projectId, doc]);

	return (
		<div className="h-[520px] w-full max-w-5xl overflow-hidden rounded-md border bg-background">
			<MatrixView projectId={projectId} doc={doc} />
		</div>
	);
}

const meta = {
	title: "PERT/MatrixView",
	component: Stage,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Diamond: Story = {
	args: { seed: diamondDoc(), projectId: "story-matrix-diamond" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId("matrix-table")).toBeInTheDocument();
		// A→B and A→C should both be active in the canonical fixture.
		await expect(
			canvas.getByTestId("matrix-cell-A-B").getAttribute("data-active"),
		).toBe("true");
		await expect(
			canvas.getByTestId("matrix-cell-A-C").getAttribute("data-active"),
		).toBe("true");
		await expect(
			canvas.getByTestId("matrix-cell-A-A").getAttribute("data-diagonal"),
		).toBe("true");
	},
};

export const Empty: Story = {
	args: {
		seed: createEmptyPertDoc("Empty"),
		projectId: "story-matrix-empty",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("No tasks yet.")).toBeInTheDocument();
	},
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Label } from "#/components/ui/label";
import { GroupCombobox, type GroupComboboxOption } from "./group-combobox";

const BASE_OPTIONS: GroupComboboxOption[] = [
	{ id: "g1", label: "1 Discovery" },
	{ id: "g2", label: "1.2 Design phase" },
	{ id: "g3", label: "2 Build" },
];

// Stateful harness: mirrors how the inspector uses the combobox — `onChange`
// re-files the task, `onCreate` makes a new group, appends it, and selects it.
function Wrapper({
	initialValue = null,
	initialOptions = BASE_OPTIONS,
}: {
	initialValue?: string | null;
	initialOptions?: GroupComboboxOption[];
}) {
	const [options, setOptions] = useState(initialOptions);
	const [value, setValue] = useState<string | null>(initialValue);
	// Monotonic across renders so repeated creates never collide on an id (a
	// plain `let` reset each render could reuse ids → duplicate React keys).
	const seq = useRef(0);
	return (
		<div className="w-72 space-y-1.5 rounded-md border bg-card p-3">
			<Label htmlFor="story-group">Group</Label>
			<GroupCombobox
				id="story-group"
				value={value}
				options={options}
				onChange={setValue}
				onCreate={(name) => {
					seq.current += 1;
					const id = `new-${seq.current}`;
					setOptions((prev) => [...prev, { id, label: name }]);
					setValue(id);
				}}
			/>
			<div className="pt-1 text-xs text-muted-foreground" data-testid="state">
				value: {value ?? "(none)"}
			</div>
		</div>
	);
}

const meta: Meta<typeof GroupCombobox> = {
	title: "PERT/Inspector/GroupCombobox",
	component: GroupCombobox,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof GroupCombobox>;

// Closed (default) state — stable screenshot baseline.
export const Default: Story = {
	render: () => <Wrapper />,
};

export const WithSelection: Story = {
	render: () => <Wrapper initialValue="g2" />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(canvas.getByTestId("inspector-group").textContent).toContain(
			"Design phase",
		);
	},
};

// Picking an existing group from the list. The popover portals to <body>, so
// query the document, not the story canvas.
export const SelectExisting: Story = {
	tags: ["no-screenshot-diff"],
	render: () => <Wrapper />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByTestId("inspector-group"));
		const body = within(document.body);
		await userEvent.click(await body.findByTestId("group-combobox-option-g3"));
		await waitFor(() =>
			expect(canvas.getByTestId("state").textContent).toContain("g3"),
		);
	},
};

// The headline behaviour: type a name that doesn't exist, then create it.
export const CreateNewGroup: Story = {
	tags: ["no-screenshot-diff"],
	render: () => <Wrapper />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByTestId("inspector-group"));
		const body = within(document.body);
		const input = await body.findByTestId("group-combobox-input");
		await userEvent.type(input, "Rollout");
		const createItem = await body.findByTestId("group-combobox-create");
		expect(createItem.textContent).toContain("Rollout");
		await userEvent.click(createItem);
		// New group is created, selected, and shown on the (now closed) trigger.
		await waitFor(() =>
			expect(canvas.getByTestId("inspector-group").textContent).toContain(
				"Rollout",
			),
		);
	},
};

// Typing the name of an existing group must NOT offer a duplicate "Create" row.
export const NoCreateForExisting: Story = {
	tags: ["no-screenshot-diff"],
	render: () => <Wrapper />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByTestId("inspector-group"));
		const body = within(document.body);
		const input = await body.findByTestId("group-combobox-input");
		await userEvent.type(input, "Build");
		await waitFor(() =>
			expect(body.queryByTestId("group-combobox-create")).toBeNull(),
		);
	},
};

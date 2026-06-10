import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { IssueLinkBadge, IssueLinkList, IssueLinksEditor } from "./issue-links";

const JIRA = "https://acme.atlassian.net/browse/{key}";

const meta: Meta<typeof IssueLinkList> = {
	title: "PERT/IssueLinks",
	component: IssueLinkList,
	decorators: [
		(Story) => (
			<div className="max-w-sm p-4">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof IssueLinkList>;

// With a template, keys render as click-through links.
export const ListWithTemplate: Story = {
	args: { issueKeys: ["PROJ-1", "PROJ-2"], template: JIRA },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const links = await canvas.findAllByTestId("issue-link");
		expect(links).toHaveLength(2);
		await expect(links[0]).toHaveAttribute(
			"href",
			"https://acme.atlassian.net/browse/PROJ-1",
		);
	},
};

// Without a template, keys show as plain text.
export const ListPlainText: Story = {
	args: { issueKeys: ["PROJ-1", "PROJ-2"], template: undefined },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(canvas.queryByTestId("issue-link")).toBeNull();
		const texts = await canvas.findAllByTestId("issue-text");
		expect(texts).toHaveLength(2);
	},
};

// Security regression: a malicious tracker template (templates live in the
// shared doc, so any collaborator can set one) must never reach the DOM as a
// clickable javascript:/data: href. The sink guard renders plain text instead.
export const MaliciousTemplateIsInert: Story = {
	args: {
		issueKeys: ["PROJ-1"],
		template: "javascript:alert(document.cookie)//{key}",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// No anchor is rendered at all…
		expect(canvas.queryByTestId("issue-link")).toBeNull();
		// …the key falls back to inert text.
		await expect(await canvas.findByTestId("issue-text")).toHaveTextContent(
			"PROJ-1",
		);
	},
};

// Security regression: protocol-relative templates (which escape the origin)
// are likewise rejected — rendered as text, never as a link.
export const ProtocolRelativeTemplateIsInert: Story = {
	args: { issueKeys: ["PROJ-1"], template: "//evil.example/{key}" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(canvas.queryByTestId("issue-link")).toBeNull();
		await expect(await canvas.findByTestId("issue-text")).toBeVisible();
	},
};

// A key that is itself a URL links directly even without a template.
export const ListUrlKey: Story = {
	args: { issueKeys: ["https://linear.app/x/issue/9"], template: undefined },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("issue-link")).toHaveAttribute(
			"href",
			"https://linear.app/x/issue/9",
		);
	},
};

// Badge: first key + overflow count.
export const Badge: StoryObj<typeof IssueLinkBadge> = {
	render: (args) => <IssueLinkBadge {...args} />,
	args: { issueKeys: ["PROJ-1", "PROJ-2", "PROJ-3"], template: JIRA },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByTestId("issue-link-badge"),
		).toHaveTextContent("+2");
	},
};

function EditorHarness() {
	const [keys, setKeys] = useState<string[]>(["PROJ-1"]);
	return (
		<IssueLinksEditor issueKeys={keys} template={JIRA} onChange={setKeys} />
	);
}

// Editor: add a key, then remove the first.
export const Editor: StoryObj = {
	render: () => <EditorHarness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByTestId("issue-link-input"),
			"PROJ-2",
		);
		await userEvent.click(await canvas.findByTestId("issue-link-add"));
		await expect(
			await canvas.findByTestId("issue-link-remove-PROJ-2"),
		).toBeVisible();
		await userEvent.click(
			await canvas.findByTestId("issue-link-remove-PROJ-1"),
		);
		expect(canvas.queryByTestId("issue-link-remove-PROJ-1")).toBeNull();
	},
};

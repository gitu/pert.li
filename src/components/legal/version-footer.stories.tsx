import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppConfigContext, DEFAULT_APP_CONFIG } from "#/lib/app-config";
import { VersionFooter } from "./version-footer";

const meta: Meta<typeof VersionFooter> = {
	title: "Legal/VersionFooter",
	component: VersionFooter,
	parameters: { layout: "centered" },
	// The footer bakes in VITE_APP_VERSION (git-describe) at build time, so its
	// render changes on every build — pixel-diffing it against the `main`
	// baseline would flag this story on every PR. Opt out of the visual diff
	// (see scripts/diff-screenshots.mjs); it still runs as a functional story.
	tags: ["no-screenshot-diff"],
};
export default meta;
type Story = StoryObj<typeof VersionFooter>;

export const Default: Story = {
	render: () => (
		<div className="bg-background p-8">
			<VersionFooter />
		</div>
	),
};

export const Inline: Story = {
	render: () => (
		<div className="bg-background p-8">
			<VersionFooter className="text-xs text-muted-foreground" />
		</div>
	),
};

// White-label deployments rebrand the footer wordmark via APP_NAME.
export const CustomBrand: Story = {
	decorators: [
		(Story) => (
			<AppConfigContext.Provider
				value={{ ...DEFAULT_APP_CONFIG, appName: "Acme Planner" }}
			>
				<Story />
			</AppConfigContext.Provider>
		),
	],
	render: () => (
		<div className="bg-background p-8">
			<VersionFooter />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Acme Planner/)).toBeInTheDocument();
	},
};

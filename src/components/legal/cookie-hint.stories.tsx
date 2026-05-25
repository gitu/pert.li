import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { CookieHint } from "./cookie-hint";

const meta: Meta<typeof CookieHint> = {
	title: "Legal/CookieHint",
	component: CookieHint,
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof CookieHint>;

const STORAGE_KEY = "pertli.cookieHintDismissed.v1";

function ClearStorage() {
	useEffect(() => {
		try {
			window.localStorage.removeItem(STORAGE_KEY);
		} catch {}
	}, []);
	return null;
}

export const Default: Story = {
	render: () => (
		<div className="min-h-svh bg-background p-6">
			<ClearStorage />
			<p className="text-sm text-muted-foreground">
				The banner sits fixed at the bottom of the page.
			</p>
			<CookieHint />
		</div>
	),
};

export const AlreadyDismissed: Story = {
	render: () => {
		// Simulate a returning visitor. The banner should not render.
		return (
			<div className="min-h-svh bg-background p-6 text-sm text-muted-foreground">
				<DismissOnMount />
				No banner should be visible — this user already dismissed it.
				<CookieHint />
			</div>
		);
	},
};

function DismissOnMount() {
	useEffect(() => {
		try {
			window.localStorage.setItem(STORAGE_KEY, "1");
		} catch {}
	}, []);
	return null;
}

import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserAvatar } from "./user-avatar";

const meta: Meta<typeof UserAvatar> = {
	title: "Account/UserAvatar",
	component: UserAvatar,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof UserAvatar>;

// Inline SVG data-URI so the "explicit image" path renders a deterministic,
// network-free image. A live URL (e.g. Unsplash) makes the screenshot diff
// flaky — it depends on whether the fetch resolves before the screenshot.
const INLINE_IMAGE =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#7c3aed"/><circle cx="48" cy="38" r="18" fill="#ede9fe"/><rect x="20" y="60" width="56" height="36" rx="18" fill="#ede9fe"/></svg>',
	);

export const ExplicitImage: Story = {
	args: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: INLINE_IMAGE,
		size: 48,
	},
};

// The Gravatar fallback fires a live network lookup, so its rendered state
// (image vs. onError → initials) isn't deterministic across runs. Skip the
// pixel diff but keep rendering it so the test-runner still exercises the path.
export const GravatarFallback: Story = {
	name: "Gravatar lookup (no explicit image)",
	tags: ["no-screenshot-diff"],
	args: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
		size: 48,
	},
};

export const InitialsOnly: Story = {
	name: "Initials when no image & no Gravatar",
	// Even with a synthetic email the Gravatar 404 resolves asynchronously, so
	// the initials may flash in after the gravatar <img> errors — non-deterministic.
	tags: ["no-screenshot-diff"],
	args: {
		// Force the Gravatar lookup to 404 by using an obviously synthetic email.
		name: "Ada Lovelace",
		email: "definitely-not-a-real-mailbox-xyz@example.invalid",
		image: null,
		size: 48,
	},
};

export const Tiny: Story = {
	tags: ["no-screenshot-diff"],
	args: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
		size: 20,
	},
};

export const NoNameNoEmail: Story = {
	args: {
		name: null,
		email: "",
		image: null,
		size: 48,
	},
};

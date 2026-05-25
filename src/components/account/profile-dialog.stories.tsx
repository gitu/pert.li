import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { ProfileDialog } from "./profile-dialog";

const meta: Meta<typeof ProfileDialog> = {
	title: "Account/ProfileDialog",
	component: ProfileDialog,
};
export default meta;
type Story = StoryObj<typeof ProfileDialog>;

function Harness({
	user,
	required,
}: {
	user: { name?: string | null; email: string; image?: string | null };
	required?: boolean;
}) {
	const [open, setOpen] = useState(true);
	return (
		<div className="p-6">
			<Button onClick={() => setOpen(true)}>Open profile dialog</Button>
			<ProfileDialog
				open={open}
				onOpenChange={setOpen}
				user={user}
				required={required}
			/>
		</div>
	);
}

export const Edit: Story = {
	render: () => (
		<Harness user={{ name: "Ada Lovelace", email: "ada@example.com" }} />
	),
};

export const NamePromptOnFirstLogin: Story = {
	name: "Required (no name yet)",
	render: () => (
		<Harness user={{ name: "", email: "ada@example.com" }} required />
	),
};

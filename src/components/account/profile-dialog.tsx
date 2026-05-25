import { useEffect, useState } from "react";
import { UserAvatar } from "#/components/account/user-avatar";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";

export type ProfileDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: {
		name?: string | null;
		email: string;
		image?: string | null;
	};
	// Set when the dialog opens because the user has no name yet. We keep the
	// copy mildly different (and disable the Cancel affordance) so it reads as a
	// nudge rather than a settings panel.
	required?: boolean;
};

export function ProfileDialog({
	open,
	onOpenChange,
	user,
	required = false,
}: ProfileDialogProps) {
	const [name, setName] = useState(user.name ?? "");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		if (open) {
			setName(user.name ?? "");
			setError(null);
		}
	}, [open, user.name]);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			setError("Please enter a name.");
			return;
		}
		setPending(true);
		setError(null);
		try {
			const result = await authClient.updateUser({ name: trimmed });
			if (result.error) {
				setError(result.error.message ?? "Could not update profile.");
				return;
			}
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unexpected error.");
		} finally {
			setPending(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// When the name is required, swallow outside-click / Esc closes — the
				// user has to actually save something. The header still explains why.
				if (!next && required) return;
				onOpenChange(next);
			}}
		>
			<DialogContent
				className="sm:max-w-md"
				// Same guard for required mode: stop Radix from closing on outside
				// interactions without forcing us to drop the visual overlay.
				onInteractOutside={(e) => {
					if (required) e.preventDefault();
				}}
				onEscapeKeyDown={(e) => {
					if (required) e.preventDefault();
				}}
			>
				<form onSubmit={submit} className="space-y-4">
					<DialogHeader>
						<DialogTitle>
							{required ? "Add your name" : "Edit profile"}
						</DialogTitle>
						<DialogDescription>
							{required
								? "Pick a display name so collaborators can see who's editing."
								: "Update how you appear to other people in your workspace."}
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-3">
						<UserAvatar
							name={name || user.name}
							email={user.email}
							image={user.image}
							size={48}
						/>
						<div className="min-w-0 text-sm">
							<div className="font-medium truncate">{user.email}</div>
							<div className="text-xs text-muted-foreground">
								Avatar comes from{" "}
								<a
									href="https://gravatar.com"
									target="_blank"
									rel="noreferrer"
									className="underline-offset-4 hover:underline"
								>
									Gravatar
								</a>{" "}
								if you have one registered for this email.
							</div>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="profile-name">Name</Label>
						<Input
							id="profile-name"
							autoFocus
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Ada Lovelace"
							disabled={pending}
							autoComplete="name"
						/>
						{error && (
							<p className="text-sm text-destructive" role="alert">
								{error}
							</p>
						)}
					</div>
					<DialogFooter>
						{!required && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => onOpenChange(false)}
								disabled={pending}
							>
								Cancel
							</Button>
						)}
						<Button type="submit" disabled={pending}>
							{pending ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

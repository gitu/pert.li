import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { inviteMember } from "#/server/workspace.ts";

export type InviteMemberDialogProps = {
	workspaceId: string | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

// Only "editor" is surfaced in the UI: "viewer" was removed when we found
// the sync server couldn't actually enforce read-only access (Automerge has
// no read-only peer mode); promotion to "owner" stays a deliberate manual
// step rather than a dropdown option.
type Role = "editor";

export function InviteMemberDialog({
	workspaceId,
	open,
	onOpenChange,
}: InviteMemberDialogProps) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("editor");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: (data: { workspaceId: string; email: string; role: Role }) =>
			inviteMember({ data }),
		onSuccess: (result) => {
			setSuccess(
				result.alreadyMember
					? `${email} is already a member.`
					: `${email} added as ${role}.`,
			);
			setEmail("");
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSuccess(null);
		if (!workspaceId) {
			setError("No workspace loaded");
			return;
		}
		mutation.mutate({ workspaceId, email, role });
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					setError(null);
					setSuccess(null);
				}
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="space-y-4">
					<DialogHeader>
						<DialogTitle>Invite a collaborator</DialogTitle>
						<DialogDescription>
							The user must already have signed up. Email invitations come in a
							later phase.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="invite-email">Email</Label>
						<Input
							id="invite-email"
							type="email"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="collaborator@example.com"
							disabled={mutation.isPending || !workspaceId}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="invite-role">Role</Label>
						<Select
							value={role}
							onValueChange={(v) => setRole(v as Role)}
							disabled={mutation.isPending}
						>
							<SelectTrigger id="invite-role" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="editor">
									Editor — can edit projects
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{error && (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					)}
					{success && (
						<output className="text-sm text-emerald-600">{success}</output>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={mutation.isPending}
						>
							Close
						</Button>
						<Button type="submit" disabled={mutation.isPending || !workspaceId}>
							{mutation.isPending ? "Inviting…" : "Invite"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

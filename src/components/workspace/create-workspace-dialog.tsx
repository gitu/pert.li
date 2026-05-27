import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { activeWorkspace } from "#/lib/active-workspace";
import { createWorkspace } from "#/server/workspace.ts";

export type CreateWorkspaceDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function CreateWorkspaceDialog({
	open,
	onOpenChange,
}: CreateWorkspaceDialogProps) {
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: () => createWorkspace({ data: { name } }),
		onSuccess: (result) => {
			// Switch to the new workspace and refresh anything that depends on
			// the membership list or per-workspace project queries.
			activeWorkspace.set(result.workspaceId);
			queryClient.invalidateQueries({ queryKey: ["my-workspaces"] });
			queryClient.invalidateQueries({ queryKey: ["projects"] });
			setName("");
			onOpenChange(false);
		},
		onError: (err) =>
			setError(
				err instanceof Error ? err.message : "Could not create workspace",
			),
	});

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		mutation.mutate();
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setError(null);
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="space-y-4">
					<DialogHeader>
						<DialogTitle>Create a workspace</DialogTitle>
						<DialogDescription>
							A workspace groups projects and members. You'll be its owner;
							invite others via the workspace home.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="new-workspace-name">Name</Label>
						<Input
							id="new-workspace-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Acme launch planning"
							required
							maxLength={80}
							autoFocus
							disabled={mutation.isPending}
							data-testid="new-workspace-name"
						/>
					</div>
					{error && (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={mutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? "Creating…" : "Create workspace"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { deleteProject } from "#/server/workspace";

export type DeleteProjectDialogProps = {
	project: {
		id: string;
		title: string;
		// When the project has live branches, warn that deleting it detaches
		// them (they survive as roots — see deleteProjectRow's set-null note).
		hasBranches?: boolean;
	};
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Called after a successful delete — e.g. to navigate away from the now-gone
	// project. Fires before the dialog's own onOpenChange(false).
	onDeleted?: () => void;
};

// Permanent, irreversible delete with a type-to-confirm guard: the destructive
// button stays disabled until the user types the project's exact title. Built
// on the plain Dialog primitive (there's no alert-dialog primitive here) and
// mirrors BranchProjectDialog's structure / error handling.
export function DeleteProjectDialog({
	project,
	open,
	onOpenChange,
	onDeleted,
}: DeleteProjectDialogProps) {
	const queryClient = useQueryClient();
	const [confirmText, setConfirmText] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Re-seed when the dialog re-opens or switches projects — the field must
	// never carry a stale match across selections (project.id is a stable
	// string, so this doesn't fire on unrelated re-renders).
	// biome-ignore lint/correctness/useExhaustiveDependencies: open + project.id are reset triggers, not values read in the body
	useEffect(() => {
		setConfirmText("");
		setError(null);
	}, [open, project.id]);

	const deletion = useMutation({
		mutationFn: () => deleteProject({ data: { projectId: project.id } }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["projects"] }),
				queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
			]);
			onDeleted?.();
			onOpenChange(false);
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const confirmed = confirmText.trim() === project.title;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-md"
				data-testid="delete-project-dialog"
			>
				<DialogHeader>
					<DialogTitle>Delete project</DialogTitle>
					<DialogDescription>
						This permanently deletes{" "}
						<span className="font-medium text-foreground">{project.title}</span>
						, including its share links and comments. This can't be undone.
						{project.hasBranches
							? " Any branches of this project will be detached and kept as standalone projects."
							: ""}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor="delete-project-confirm-input">
						Type{" "}
						<span className="font-medium text-foreground">{project.title}</span>{" "}
						to confirm
					</Label>
					<Input
						id="delete-project-confirm-input"
						autoFocus
						value={confirmText}
						onChange={(e) => setConfirmText(e.target.value)}
						disabled={deletion.isPending}
						autoComplete="off"
						data-testid="delete-project-confirm-input"
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
						disabled={deletion.isPending}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={!confirmed || deletion.isPending}
						onClick={() => {
							setError(null);
							deletion.mutate();
						}}
						data-testid="delete-project-confirm"
					>
						{deletion.isPending ? "Deleting…" : "Delete project"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

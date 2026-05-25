import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { createProject } from "#/server/workspace.ts";

export type CreateProjectDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function CreateProjectDialog({
	open,
	onOpenChange,
}: CreateProjectDialogProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [title, setTitle] = useState("");
	const [error, setError] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: (data: { title: string }) => createProject({ data }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: ["projects"] });
			onOpenChange(false);
			setTitle("");
			navigate({
				to: "/p/$projectId",
				params: { projectId: result.id },
			});
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		const trimmed = title.trim();
		if (!trimmed) {
			setError("Title is required");
			return;
		}
		mutation.mutate({ title: trimmed });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="space-y-4">
					<DialogHeader>
						<DialogTitle>New project</DialogTitle>
						<DialogDescription>
							Each project gets its own Automerge document. You'll be its owner.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="project-title">Title</Label>
						<Input
							id="project-title"
							autoFocus
							required
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="e.g. Q3 launch plan"
							disabled={mutation.isPending}
						/>
						{error && (
							<p className="text-sm text-destructive" role="alert">
								{error}
							</p>
						)}
					</div>
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
							{mutation.isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

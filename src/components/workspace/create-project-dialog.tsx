import { useMutation } from "@tanstack/react-query";
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
import { useActiveWorkspaceId } from "#/lib/active-workspace";
import { useOptionalRepo } from "#/lib/automerge/provider";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { randomId } from "#/lib/random-id";
import { addPending } from "#/lib/sync/pending-projects";
import { requestReconcile } from "#/lib/sync/reconcile-pending";

export type CreateProjectDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function CreateProjectDialog({
	open,
	onOpenChange,
}: CreateProjectDialogProps) {
	const navigate = useNavigate();
	const repo = useOptionalRepo();
	const activeWorkspaceId = useActiveWorkspaceId();
	const [title, setTitle] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Local-first creation: mint the Automerge doc in the browser repo right
	// away so the project is instantly usable (and offline-durable), queue it in
	// the pending store, and navigate to it. Registration with the server (and
	// the route remap to the canonical id) is handled by the reconcile loop —
	// which we nudge immediately so an online create still registers within a
	// tick. No network is on this path, so it can't fail when offline.
	const mutation = useMutation({
		// "always": this mutation does no network (doc is created in the local
		// repo, metadata queued in IndexedDB), so it must run even when offline.
		// The default "online" mode would pause it until reconnect — defeating
		// offline creation.
		networkMode: "always",
		mutationFn: async (data: { title: string }) => {
			if (!repo) throw new Error("Local sync repo isn't ready yet");
			const handle = repo.create(createEmptyPertDoc(data.title));
			const localId = randomId();
			await addPending({
				localId,
				title: data.title,
				automergeDocUrl: handle.url,
				createdAt: new Date().toISOString(),
				...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
			});
			return { localId };
		},
		onSuccess: ({ localId }) => {
			onOpenChange(false);
			setTitle("");
			navigate({ to: "/p/$projectId", params: { projectId: localId } });
			// Fire-and-forget: register now if we're online + authed.
			void requestReconcile();
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

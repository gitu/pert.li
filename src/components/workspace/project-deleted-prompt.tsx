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
import type { PendingProject } from "#/lib/sync/pending-projects";
import { removePending, updatePending } from "#/lib/sync/pending-projects";
import { registerProject } from "#/server/workspace";

export type ProjectDeletedPromptProps = {
	// The orphaned local queue record: registered server-side at some point, but
	// its row is now gone. Its automergeDocUrl still points at a live local doc,
	// so restore is a re-register (idempotent on the URL) with no data loss.
	pending: PendingProject;
	// Optional overrides so the component is drivable in Storybook without a
	// router/query client. Default to the real navigation + invalidation.
	onRestored?: (projectId: string) => void;
	onDiscarded?: () => void;
};

// Shown by the project canvas when you open a project that was deleted elsewhere
// while a stale local record kept it in your list. Hard delete is irreversible
// server-side, but the local Automerge doc survives — so we offer two honest
// choices: restore it (re-create the server row from the local doc) or discard
// the leftover record (matching the delete that already happened).
export function ProjectDeletedPrompt({
	pending,
	onRestored,
	onDiscarded,
}: ProjectDeletedPromptProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);

	const restore = useMutation({
		mutationFn: async () => {
			const result = await registerProject({
				data: {
					title: pending.title,
					description: pending.description,
					// "" (no known workspace) → omit so it lands in the personal ws.
					workspaceId: pending.workspaceId || undefined,
					automergeDocUrl: pending.automergeDocUrl,
				},
			});
			const newId = result.project.id;
			// Converge the lingering record onto the fresh row exactly as the
			// reconcile success path does (processRecord in reconcile-pending.ts):
			// persist the canonical id + workspace so the list dedups it again, and
			// clear any stale retry metadata so a previously-errored record doesn't
			// carry it forward.
			await updatePending(pending.localId, {
				status: "registered",
				serverId: newId,
				workspaceId: result.project.workspaceId,
				attempts: 0,
				lastError: undefined,
				lastErrorKind: undefined,
				nextRetryAt: undefined,
			});
			return newId;
		},
		onSuccess: async (newId) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["projects"] }),
				queryClient.invalidateQueries({ queryKey: ["project", newId] }),
				queryClient.invalidateQueries({
					queryKey: ["project", pending.serverId ?? pending.localId],
				}),
			]);
			if (onRestored) onRestored(newId);
			else navigate({ to: "/p/$projectId", params: { projectId: newId } });
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const discard = useMutation({
		mutationFn: () => removePending(pending.localId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["projects"] });
			if (onDiscarded) onDiscarded();
			else navigate({ to: "/" });
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const busy = restore.isPending || discard.isPending;

	return (
		<Dialog open>
			<DialogContent
				className="sm:max-w-md"
				data-testid="project-deleted-prompt"
				// No dismiss affordance: opening a deleted project forces a choice
				// rather than dropping the user onto a dead canvas.
				showCloseButton={false}
				onPointerDownOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>This project was deleted</DialogTitle>
					<DialogDescription>
						<span className="font-medium text-foreground">{pending.title}</span>{" "}
						was deleted from the server, but a copy still lives on this device.
						Restore it to bring it back, or delete it here to match.
					</DialogDescription>
				</DialogHeader>
				{error && (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button
						type="button"
						variant="destructive"
						disabled={busy}
						onClick={() => {
							setError(null);
							discard.mutate();
						}}
						data-testid="project-deleted-discard"
					>
						{discard.isPending ? "Deleting…" : "Delete here"}
					</Button>
					<Button
						type="button"
						disabled={busy}
						onClick={() => {
							setError(null);
							restore.mutate();
						}}
						data-testid="project-deleted-restore"
					>
						{restore.isPending ? "Restoring…" : "Restore project"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

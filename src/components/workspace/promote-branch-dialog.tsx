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
import { promoteBranch } from "#/server/workspace";

// Confirm + perform "promote a branch to a standalone plan". Detaching is a
// structural change (the project leaves its parent's tree and loses its merge
// base), so we gate it behind a small confirm. Sub-branches stay attached to
// the promoted project. Reused by the project header menu and the home card.
export type PromoteBranchDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	project: { id: string; title: string };
	onPromoted?: () => void;
};

export function PromoteBranchDialog({
	open,
	onOpenChange,
	project,
	onPromoted,
}: PromoteBranchDialogProps) {
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);

	// Drop any prior error when the dialog (re)opens. Both call sites mount this
	// conditionally so today it always opens fresh, but this keeps it correct if
	// it's ever kept mounted and toggled via `open` instead.
	useEffect(() => {
		if (open) setError(null);
	}, [open]);

	const mutation = useMutation({
		mutationFn: () => promoteBranch({ data: { projectId: project.id } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["projects"] });
			await queryClient.invalidateQueries({
				queryKey: ["project", project.id],
			});
			onOpenChange(false);
			onPromoted?.();
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-md"
				data-testid="promote-branch-dialog"
			>
				<DialogHeader>
					<DialogTitle>Promote to standalone plan</DialogTitle>
					<DialogDescription>
						<strong className="font-medium text-foreground">
							{project.title}
						</strong>{" "}
						will become its own top-level plan — it'll no longer be a branch of
						another plan, and the “Compare &amp; merge” link to its parent goes
						away. Any branches of this plan stay attached to it. This can't be
						undone automatically.
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
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={mutation.isPending}
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => {
							setError(null);
							mutation.mutate();
						}}
						disabled={mutation.isPending}
						data-testid="promote-branch-confirm"
					>
						{mutation.isPending ? "Promoting…" : "Promote"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

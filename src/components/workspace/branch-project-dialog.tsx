import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { Textarea } from "#/components/ui/textarea";
import { forkProject, updateProjectMeta } from "#/server/workspace";

const DESCRIPTION_HINT = 200;

// One dialog, two modes:
//   - mode === "fork": creates a new branch project off `parent`, prompts for
//     the branch's title + an optional description, then routes to it.
//   - mode === "edit": updates the title/description of `parent` in place
//     (works on roots and branches alike).
export type BranchProjectDialogProps =
	| {
			mode: "fork";
			open: boolean;
			onOpenChange: (open: boolean) => void;
			parent: {
				id: string;
				title: string;
			};
			// Used to suggest a non-colliding default ("Parent — branch 3"). Pass
			// the count of existing live branches; the dialog defaults to N+1.
			existingBranchCount: number;
	  }
	| {
			mode: "edit";
			open: boolean;
			onOpenChange: (open: boolean) => void;
			project: {
				id: string;
				title: string;
				description: string | null;
				isBranch: boolean;
			};
	  };

export function BranchProjectDialog(props: BranchProjectDialogProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const initialTitle =
		props.mode === "fork"
			? `${props.parent.title} — branch ${props.existingBranchCount + 1}`
			: props.project.title;
	const initialDescription =
		props.mode === "fork" ? "" : (props.project.description ?? "");

	const [title, setTitle] = useState(initialTitle);
	const [description, setDescription] = useState(initialDescription);
	const [error, setError] = useState<string | null>(null);

	// Re-seed when the dialog re-opens or the underlying project changes (the
	// rename dialog gets reused across different selections).
	useEffect(() => {
		if (props.open) {
			setTitle(initialTitle);
			setDescription(initialDescription);
			setError(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.open, initialTitle, initialDescription]);

	const forkMutation = useMutation({
		mutationFn: (data: { title: string; description: string | null }) =>
			forkProject({
				data: {
					parentProjectId: props.mode === "fork" ? props.parent.id : "",
					title: data.title,
					description: data.description,
				},
			}),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: ["projects"] });
			props.onOpenChange(false);
			navigate({ to: "/p/$projectId", params: { projectId: result.id } });
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const updateMutation = useMutation({
		mutationFn: (data: { title: string; description: string | null }) =>
			updateProjectMeta({
				data: {
					projectId: props.mode === "edit" ? props.project.id : "",
					title: data.title,
					description: data.description,
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["projects"] });
			await queryClient.invalidateQueries({
				queryKey: ["project", props.mode === "edit" ? props.project.id : null],
			});
			props.onOpenChange(false);
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const pending = forkMutation.isPending || updateMutation.isPending;

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		const trimmedTitle = title.trim();
		const trimmedDescription = description.trim();
		if (!trimmedTitle) {
			setError("Title is required");
			return;
		}
		const payload = {
			title: trimmedTitle,
			description: trimmedDescription === "" ? null : trimmedDescription,
		};
		if (props.mode === "fork") forkMutation.mutate(payload);
		else updateMutation.mutate(payload);
	};

	const headerTitle =
		props.mode === "fork" ? "Branch this plan" : "Rename / describe project";
	const headerDescription =
		props.mode === "fork"
			? "Branches are independent copies of the plan. Their share links are separate from the parent — nothing leaks back unless you merge."
			: "Both title and description are visible to everyone with access. The description appears beside the project in the sidebar.";
	const submitLabel =
		props.mode === "fork"
			? pending
				? "Creating…"
				: "Create branch"
			: pending
				? "Saving…"
				: "Save";

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent
				className="sm:max-w-md"
				data-testid="branch-project-dialog"
			>
				<form onSubmit={submit} className="space-y-4">
					<DialogHeader>
						<DialogTitle>{headerTitle}</DialogTitle>
						<DialogDescription>{headerDescription}</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="branch-title">
							{props.mode === "fork" ? "Branch name" : "Title"}
						</Label>
						<Input
							id="branch-title"
							autoFocus
							required
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							disabled={pending}
							maxLength={120}
							data-testid="branch-project-dialog-title"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="branch-description">
							Description{" "}
							<span className="text-xs font-normal text-muted-foreground">
								(optional)
							</span>
						</Label>
						<Textarea
							id="branch-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={
								props.mode === "fork"
									? "Why this branch? (e.g. trying QA in parallel with implementation)"
									: "One-line description, visible to anyone with access"
							}
							rows={3}
							maxLength={500}
							disabled={pending}
							data-testid="branch-project-dialog-description"
						/>
						<div className="flex items-center justify-between text-[10px] text-muted-foreground">
							<span>
								{description.length > DESCRIPTION_HINT && (
									<>
										{description.length}/500 — keep it scannable in the sidebar.
									</>
								)}
							</span>
						</div>
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
							onClick={() => props.onOpenChange(false)}
							disabled={pending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={pending}>
							{submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

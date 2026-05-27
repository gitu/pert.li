import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
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
import {
	EXCHANGE_FILE_EXTENSION,
	type PertExchange,
	parseExchange,
	summarizeExchange,
} from "#/lib/pert/exchange";
import { importProject } from "#/server/workspace.ts";

export type ImportProjectDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type FilePick = {
	filename: string;
	exchange: PertExchange;
};

export function ImportProjectDialog({
	open,
	onOpenChange,
}: ImportProjectDialogProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const activeWorkspaceId = useActiveWorkspaceId();
	const fileInputId = useId();
	const titleInputId = useId();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [pick, setPick] = useState<FilePick | null>(null);
	const [titleOverride, setTitleOverride] = useState("");
	const [parseError, setParseError] = useState<string | null>(null);

	const reset = () => {
		setPick(null);
		setTitleOverride("");
		setParseError(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const mutation = useMutation({
		mutationFn: async () => {
			if (!pick) throw new Error("Pick a file first");
			return importProject({
				data: {
					exchange: pick.exchange,
					...(titleOverride.trim() ? { title: titleOverride.trim() } : {}),
					...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
				},
			});
		},
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: ["projects"] });
			onOpenChange(false);
			reset();
			navigate({
				to: "/p/$projectId",
				params: { projectId: result.id },
			});
		},
	});

	const handleFile = async (file: File | null) => {
		setParseError(null);
		setPick(null);
		if (!file) return;
		const text = await file.text();
		const result = parseExchange(text);
		if (!result.ok) {
			setParseError(result.error);
			return;
		}
		setPick({ filename: file.name, exchange: result.exchange });
		setTitleOverride(result.exchange.title);
	};

	const summary = pick ? summarizeExchange(pick.exchange) : null;

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!pick || mutation.isPending) return;
		mutation.mutate();
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) reset();
			}}
		>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="space-y-4">
					<DialogHeader>
						<DialogTitle>Import project</DialogTitle>
						<DialogDescription>
							Upload a {EXCHANGE_FILE_EXTENSION} file exported from pert.li to
							create a new project from its contents.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor={fileInputId}>File</Label>
						<Input
							id={fileInputId}
							ref={fileInputRef}
							type="file"
							accept=".json,application/json"
							onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
							disabled={mutation.isPending}
							data-testid="import-project-file"
						/>
						{parseError && (
							<p className="text-sm text-destructive" role="alert">
								Couldn't read that file — {parseError}
							</p>
						)}
					</div>
					{summary && (
						<div className="rounded-md border bg-muted/30 p-3 text-xs">
							<div
								className="mb-1 font-medium"
								data-testid="import-project-summary-title"
							>
								{summary.title}
							</div>
							<div
								className="text-muted-foreground"
								data-testid="import-project-summary-counts"
							>
								{summary.taskCount} task{summary.taskCount === 1 ? "" : "s"} ·{" "}
								{summary.milestoneCount} milestone
								{summary.milestoneCount === 1 ? "" : "s"} ·{" "}
								{summary.containerCount} container
								{summary.containerCount === 1 ? "" : "s"} ·{" "}
								{summary.dependencyCount} dependency
								{summary.dependencyCount === 1 ? "" : "ies"}
								{summary.hasCalendar && " · calendar"}
							</div>
						</div>
					)}
					{pick && (
						<div className="space-y-2">
							<Label htmlFor={titleInputId}>Project title</Label>
							<Input
								id={titleInputId}
								value={titleOverride}
								onChange={(e) => setTitleOverride(e.target.value)}
								disabled={mutation.isPending}
								placeholder={pick.exchange.title}
								data-testid="import-project-title"
							/>
							<p className="text-xs text-muted-foreground">
								Defaults to the title in the file. Edit to give the imported
								copy a new name.
							</p>
						</div>
					)}
					{mutation.isError && (
						<p className="text-sm text-destructive" role="alert">
							{mutation.error instanceof Error
								? mutation.error.message
								: "Import failed."}
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
							type="submit"
							disabled={!pick || mutation.isPending}
							data-testid="import-project-submit"
						>
							<UploadIcon className="size-4" />
							{mutation.isPending ? "Importing…" : "Import"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

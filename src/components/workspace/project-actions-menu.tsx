import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useNavigate } from "@tanstack/react-router";
import {
	ArrowUpFromLineIcon,
	DownloadIcon,
	MoreHorizontalIcon,
	PencilIcon,
	Share2Icon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useOptionalRepo } from "#/lib/automerge/provider";
import {
	EXCHANGE_MIME_TYPE,
	serializeExchange,
	suggestExportFilename,
} from "#/lib/pert/exchange";
import type { PertDoc } from "#/lib/pert/types";
import { cn } from "#/lib/utils";
import type { ProjectSummary } from "#/types/workspace";
import { BranchProjectDialog } from "./branch-project-dialog";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { PromoteBranchDialog } from "./promote-branch-dialog";
import { ShareProjectDialog } from "./share-project-dialog";

export type ProjectActionsMenuProps = {
	project: ProjectSummary;
	// True when this project is the one currently open — lets the caller redirect
	// home after it's deleted out from under the view.
	isActive?: boolean;
	onDeleted?: () => void;
	className?: string;
};

// Resolve the project's Automerge doc on demand (sidebar rows don't preload it)
// and trigger a .pert.json download. Mirrors ExportProjectButton's download
// path, but fetches the doc via the repo first.
async function exportProject(
	repo: ReturnType<typeof useOptionalRepo>,
	project: ProjectSummary,
) {
	if (!repo) {
		toast.error("Export isn't ready yet — try again in a moment.");
		return;
	}
	let doc: PertDoc | undefined;
	try {
		const handle = await repo.find<PertDoc>(
			project.automergeDocUrl as AutomergeUrl,
			{ allowableStates: ["ready", "unavailable"] },
		);
		// find() can resolve a still-"unavailable" handle (the doc hasn't synced
		// yet) — its doc() would be undefined. Give it a bounded moment to become
		// ready before giving up, rather than failing a doc that's about to load.
		if (!handle.isReady()) {
			await Promise.race([
				handle.whenReady(["ready"]).catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, 5000)),
			]);
		}
		doc = handle.doc();
	} catch {
		doc = undefined;
	}
	if (!doc) {
		toast.error("Couldn't load this project to export.");
		return;
	}
	const contents = serializeExchange(doc);
	const filename = suggestExportFilename(doc.title ?? project.title);
	const blob = new Blob([contents], { type: EXCHANGE_MIME_TYPE });
	const href = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement("a");
		anchor.href = href;
		anchor.download = filename;
		anchor.rel = "noopener";
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		URL.revokeObjectURL(href);
	}
}

// Per-project "⋯" menu shared by the sidebar rows. Bundles the lifecycle
// actions (Edit / Share / Export / Promote / Delete) that the Overview tab also
// exposes as standalone buttons. Promote only shows for branches.
export function ProjectActionsMenu({
	project,
	isActive,
	onDeleted,
	className,
}: ProjectActionsMenuProps) {
	const repo = useOptionalRepo();
	const navigate = useNavigate();
	const [editOpen, setEditOpen] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);
	const [promoteOpen, setPromoteOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	const isBranch = project.parentProjectId != null;
	// Offline-created rows (still pending server registration) carry an empty
	// creator and can't be mutated server-side yet — hide the menu until the
	// reconcile loop registers them. Matches the workspace-home cards.
	if (project.createdBy === "") return null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className={cn("text-muted-foreground", className)}
						// Static accessible name on purpose — interpolating the project
						// title would leak it into the accessible-name namespace, where
						// substring getByLabel/getByRole(name) queries elsewhere (e.g. a
						// project titled "…(renamed)" vs getByLabel("Name")) would then
						// match this button too. The row's title text sits right beside it.
						aria-label="Project actions"
						title="Project actions"
						data-testid={`project-actions-${project.id}`}
						// Keep the click from bubbling to the row Link / selecting it.
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
						}}
					>
						<MoreHorizontalIcon className="size-3.5" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					data-testid={`project-actions-menu-${project.id}`}
				>
					<DropdownMenuItem
						onSelect={() => setEditOpen(true)}
						data-testid={`project-action-edit-${project.id}`}
					>
						<PencilIcon className="size-3.5" />
						Edit
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => setShareOpen(true)}
						data-testid={`project-action-share-${project.id}`}
					>
						<Share2Icon className="size-3.5" />
						Share
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => void exportProject(repo, project)}
						data-testid={`project-action-export-${project.id}`}
					>
						<DownloadIcon className="size-3.5" />
						Export
					</DropdownMenuItem>
					{isBranch && (
						<DropdownMenuItem
							onSelect={() => setPromoteOpen(true)}
							data-testid={`project-action-promote-${project.id}`}
						>
							<ArrowUpFromLineIcon className="size-3.5" />
							Promote to standalone plan
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => setDeleteOpen(true)}
						data-testid={`project-action-delete-${project.id}`}
					>
						<Trash2Icon className="size-3.5" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{editOpen && (
				<BranchProjectDialog
					mode="edit"
					open={editOpen}
					onOpenChange={setEditOpen}
					project={{
						id: project.id,
						title: project.title,
						description: project.description,
						isBranch: project.parentProjectId != null,
					}}
				/>
			)}
			<ShareProjectDialog
				projectId={project.id}
				open={shareOpen}
				onOpenChange={setShareOpen}
			/>
			{promoteOpen && (
				<PromoteBranchDialog
					open={promoteOpen}
					onOpenChange={setPromoteOpen}
					project={{ id: project.id, title: project.title }}
				/>
			)}
			{deleteOpen && (
				<DeleteProjectDialog
					project={{ id: project.id, title: project.title }}
					open={deleteOpen}
					onOpenChange={setDeleteOpen}
					onDeleted={() => {
						// Leaving the route is only needed when we just deleted the
						// project the user is looking at.
						if (isActive) navigate({ to: "/" });
						onDeleted?.();
					}}
				/>
			)}
		</>
	);
}

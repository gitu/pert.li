import { Link } from "@tanstack/react-router";
import {
	ArrowUpFromLineIcon,
	FileTextIcon,
	GitBranchIcon,
	MoreHorizontalIcon,
	PencilIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { cn } from "#/lib/utils";
import {
	buildProjectTree,
	type ProjectTreeNode,
} from "#/lib/workspace/project-tree";
import type { ProjectSummary } from "#/types/workspace";
import { BranchProjectDialog } from "./branch-project-dialog";
import { PromoteBranchDialog } from "./promote-branch-dialog";

export type ProjectListProps = {
	projects: ProjectSummary[];
	activeProjectId?: string;
	empty?: React.ReactNode;
	onSelect?: (project: ProjectSummary) => void;
};

// Renders the workspace's project list as a recursive branch tree. Branches
// nest under their parent to arbitrary depth (a branch of a branch sits one
// level deeper, not flattened to the root). Branches whose parent isn't in the
// same list (archived, in a different workspace, or just absent) bubble up to
// root level — flagged as orphan branches — so they stay reachable instead of
// disappearing. Each row carries a ⋯ menu (Rename, and Promote for branches),
// matching the workspace-home cards.

export function ProjectList({
	projects,
	activeProjectId,
	empty,
	onSelect,
}: ProjectListProps) {
	if (projects.length === 0) {
		return (
			<div className="px-3 py-2 text-xs text-muted-foreground">
				{empty ?? "No projects yet."}
			</div>
		);
	}
	const tree = buildProjectTree(projects);
	return (
		<ul className="flex flex-col gap-0.5 px-1.5 py-1 text-sm">
			{tree.map((node) => (
				<ProjectNode
					key={node.project.id}
					node={node}
					activeProjectId={activeProjectId}
					onSelect={onSelect}
				/>
			))}
		</ul>
	);
}

function ProjectNode({
	node,
	activeProjectId,
	onSelect,
}: {
	node: ProjectTreeNode;
	activeProjectId?: string;
	onSelect?: (project: ProjectSummary) => void;
}) {
	const { project, children, isOrphanBranch } = node;
	const kind = !project.parentProjectId
		? "root"
		: isOrphanBranch
			? "orphan-branch"
			: "branch";
	return (
		<li className="flex flex-col">
			<ProjectRow
				project={project}
				active={project.id === activeProjectId}
				onSelect={onSelect}
				kind={kind}
			/>
			{children.length > 0 && (
				<ul
					className="ml-2 mt-0.5 border-l border-border pl-1"
					data-testid={`project-branches-${project.id}`}
				>
					{children.map((child) => (
						<ProjectNode
							key={child.project.id}
							node={child}
							activeProjectId={activeProjectId}
							onSelect={onSelect}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function ProjectRow({
	project,
	active,
	onSelect,
	kind,
}: {
	project: ProjectSummary;
	active: boolean;
	onSelect?: (project: ProjectSummary) => void;
	kind: "root" | "branch" | "orphan-branch";
}) {
	const [renameOpen, setRenameOpen] = useState(false);
	const [promoteOpen, setPromoteOpen] = useState(false);
	const isBranch = kind !== "root";
	// Offline-created rows (still pending server registration) carry an empty
	// creator and can't be edited yet — same "safe to edit" signal the home
	// cards use. The menu appears on its own once the reconcile loop registers.
	const canEdit = project.createdBy !== "";

	return (
		<div
			className={cn(
				"group flex items-stretch rounded-md transition-colors",
				active
					? "bg-accent text-accent-foreground"
					: "hover:bg-accent/60 hover:text-accent-foreground",
			)}
		>
			<Link
				to="/p/$projectId"
				params={{ projectId: project.id }}
				onClick={() => onSelect?.(project)}
				data-testid={`project-row-${project.id}`}
				data-kind={kind}
				className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5"
			>
				{isBranch ? (
					<GitBranchIcon
						className="mt-0.5 size-3.5 shrink-0 text-primary"
						aria-hidden
					/>
				) : (
					<FileTextIcon
						className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
						aria-hidden
					/>
				)}
				<div className="min-w-0 flex-1">
					<div className="truncate">{project.title}</div>
					{project.description && (
						<div
							className="truncate text-[10px] text-muted-foreground"
							title={project.description}
						>
							{project.description}
						</div>
					)}
					{kind === "orphan-branch" && (
						<div className="text-[10px] italic text-muted-foreground">
							branch · parent unavailable
						</div>
					)}
				</div>
			</Link>
			{canEdit && (
				<div className="flex items-center pr-1">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="size-6 shrink-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
								data-testid={`project-row-menu-${project.id}`}
								title="Project options"
							>
								<MoreHorizontalIcon className="size-3.5" />
								<span className="sr-only">Project options</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onSelect={() => setRenameOpen(true)}
								data-testid={`project-row-rename-action-${project.id}`}
							>
								<PencilIcon className="size-3.5" />
								Rename / edit description
							</DropdownMenuItem>
							{isBranch && (
								<DropdownMenuItem
									onSelect={() => setPromoteOpen(true)}
									data-testid={`project-row-promote-action-${project.id}`}
								>
									<ArrowUpFromLineIcon className="size-3.5" />
									Promote to standalone plan
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			)}
			{renameOpen && (
				<BranchProjectDialog
					mode="edit"
					open={renameOpen}
					onOpenChange={setRenameOpen}
					project={{
						id: project.id,
						title: project.title,
						description: project.description,
						isBranch,
					}}
				/>
			)}
			{promoteOpen && (
				<PromoteBranchDialog
					open={promoteOpen}
					onOpenChange={setPromoteOpen}
					project={{ id: project.id, title: project.title }}
				/>
			)}
		</div>
	);
}

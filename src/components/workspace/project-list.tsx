import { Link } from "@tanstack/react-router";
import { FileTextIcon, GitBranchIcon } from "lucide-react";
import { cn } from "#/lib/utils";
import {
	buildProjectTree,
	type ProjectTreeNode,
} from "#/lib/workspace/project-tree";
import type { ProjectView } from "#/routes/_app/p.$projectId";
import type { ProjectSummary } from "#/types/workspace";
import { ProjectActionsMenu } from "./project-actions-menu";

export type ProjectListProps = {
	projects: ProjectSummary[];
	activeProjectId?: string;
	// The view currently active on the open project (URL `view` search param).
	// When set, switching to another project carries this view across so the
	// user stays on e.g. the Network view instead of bouncing to Overview.
	currentView?: ProjectView;
	empty?: React.ReactNode;
	onSelect?: (project: ProjectSummary) => void;
};

// Renders the workspace's project list as a recursive branch tree. Branches
// nest under their parent to arbitrary depth (a branch of a branch sits one
// level deeper, not flattened to the root). Branches whose parent isn't in the
// same list (archived, in a different workspace, or just absent) bubble up to
// root level — flagged as orphan branches — so they stay reachable instead of
// disappearing. Each row carries a ⋯ menu (Edit / Share / Export / Promote for
// branches / Delete), matching the workspace-home cards.

export function ProjectList({
	projects,
	activeProjectId,
	currentView,
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
					currentView={currentView}
					onSelect={onSelect}
				/>
			))}
		</ul>
	);
}

function ProjectNode({
	node,
	activeProjectId,
	currentView,
	onSelect,
}: {
	node: ProjectTreeNode;
	activeProjectId?: string;
	currentView?: ProjectView;
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
				currentView={currentView}
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
							currentView={currentView}
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
	currentView,
	onSelect,
	kind,
}: {
	project: ProjectSummary;
	active: boolean;
	currentView?: ProjectView;
	onSelect?: (project: ProjectSummary) => void;
	kind: "root" | "branch" | "orphan-branch";
}) {
	const isBranch = kind !== "root";

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
				// Carry the open project's active view across the switch so e.g.
				// Network stays Network. "overview" maps to no param to match the
				// in-project view switcher's URL normalization (setView).
				search={{
					view: currentView === "overview" ? undefined : currentView,
				}}
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
			{/* ProjectActionsMenu self-hides for offline/unregistered rows
			    (createdBy === ""), so it's safe to always render. */}
			<div className="flex items-center pr-1">
				<ProjectActionsMenu
					project={project}
					isActive={active}
					className="size-6 shrink-0 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
				/>
			</div>
		</div>
	);
}

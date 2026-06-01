import { Link } from "@tanstack/react-router";
import { FileTextIcon, GitBranchIcon } from "lucide-react";
import { cn } from "#/lib/utils";
import type { ProjectSummary } from "#/types/workspace";

export type ProjectListProps = {
	projects: ProjectSummary[];
	activeProjectId?: string;
	empty?: React.ReactNode;
	onSelect?: (project: ProjectSummary) => void;
};

// Renders the workspace's project list with branches grouped under their
// parent project. Branches whose parent isn't in the same list (archived,
// in a different workspace, or just absent) bubble up to root level so they
// stay reachable instead of disappearing.

type Group = {
	root: ProjectSummary;
	branches: ProjectSummary[];
};

function groupByParent(projects: ProjectSummary[]): Group[] {
	const byId = new Map<string, ProjectSummary>();
	for (const p of projects) byId.set(p.id, p);
	const groups = new Map<string, Group>();
	for (const p of projects) {
		if (!p.parentProjectId || !byId.has(p.parentProjectId)) {
			// Treat as root (orphan branches included).
			if (!groups.has(p.id)) groups.set(p.id, { root: p, branches: [] });
		}
	}
	for (const p of projects) {
		if (p.parentProjectId && byId.has(p.parentProjectId)) {
			const g = groups.get(p.parentProjectId);
			if (g) g.branches.push(p);
		}
	}
	// Sort branches deterministically — oldest fork first so the order doesn't
	// shuffle when a new branch lands.
	for (const g of groups.values()) {
		g.branches.sort((a, b) => {
			const ba = a.branchedAt ?? a.createdAt;
			const bb = b.branchedAt ?? b.createdAt;
			return ba.localeCompare(bb);
		});
	}
	// Preserve the input ordering of roots (the caller sorts by createdAt
	// already; respect that).
	const seen = new Set<string>();
	const out: Group[] = [];
	for (const p of projects) {
		const g = groups.get(p.id);
		if (g && !seen.has(p.id)) {
			seen.add(p.id);
			out.push(g);
		}
	}
	return out;
}

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
	const groups = groupByParent(projects);
	return (
		<ul className="flex flex-col gap-0.5 px-1.5 py-1 text-sm">
			{groups.map((g) => (
				<li key={g.root.id} className="flex flex-col">
					<ProjectRow
						project={g.root}
						active={g.root.id === activeProjectId}
						onSelect={onSelect}
						kind={g.root.parentProjectId ? "orphan-branch" : "root"}
					/>
					{g.branches.length > 0 && (
						<ul
							className="ml-2 mt-0.5 border-l border-border pl-1"
							data-testid={`project-branches-${g.root.id}`}
						>
							{g.branches.map((b) => (
								<li key={b.id}>
									<ProjectRow
										project={b}
										active={b.id === activeProjectId}
										onSelect={onSelect}
										kind="branch"
									/>
								</li>
							))}
						</ul>
					)}
				</li>
			))}
		</ul>
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
	const isBranch = kind !== "root";
	return (
		<Link
			to="/p/$projectId"
			params={{ projectId: project.id }}
			onClick={() => onSelect?.(project)}
			data-testid={`project-row-${project.id}`}
			data-kind={kind}
			className={cn(
				"flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors",
				active
					? "bg-accent text-accent-foreground"
					: "hover:bg-accent/60 hover:text-accent-foreground",
			)}
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
	);
}

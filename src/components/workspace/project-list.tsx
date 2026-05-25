import { Link } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";
import type { ProjectSummary } from "#/types/workspace";

export type ProjectListProps = {
	projects: ProjectSummary[];
	activeProjectId?: string;
	empty?: React.ReactNode;
};

export function ProjectList({
	projects,
	activeProjectId,
	empty,
}: ProjectListProps) {
	if (projects.length === 0) {
		return (
			<div className="px-3 py-2 text-xs text-muted-foreground">
				{empty ?? "No projects yet."}
			</div>
		);
	}
	return (
		<ul className="flex flex-col gap-0.5 px-1.5 py-1 text-sm">
			{projects.map((project) => {
				const active = project.id === activeProjectId;
				return (
					<li key={project.id}>
						<Link
							to="/p/$projectId"
							params={{ projectId: project.id }}
							className={[
								"flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
								active
									? "bg-accent text-accent-foreground"
									: "hover:bg-accent/60 hover:text-accent-foreground",
							].join(" ")}
						>
							<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="truncate">{project.title}</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { FolderTreeIcon, PlusIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Separator } from "#/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import { ProjectList } from "#/components/workspace/project-list";
import { listProjects } from "#/server/workspace.ts";

// Phone equivalent of the desktop LeftNav sidebar — wraps the same Project
// list inside a left-side Sheet. Triggered by the hamburger in the mobile
// top bar.

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNewProject: () => void;
};

export function MobileProjectsSheet({
	open,
	onOpenChange,
	onNewProject,
}: Props) {
	const projectsQuery = useQuery({
		queryKey: ["projects"],
		queryFn: () => listProjects(),
	});
	const params = useParams({ strict: false }) as { projectId?: string };

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
				<SheetHeader className="shrink-0 border-b p-3 text-left">
					<SheetTitle className="text-base">Projects</SheetTitle>
					<SheetDescription className="sr-only">
						Switch between projects in your workspace.
					</SheetDescription>
				</SheetHeader>
				<nav className="flex flex-col gap-1 p-2 text-sm">
					<Link
						to="/"
						onClick={() => onOpenChange(false)}
						className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
						activeOptions={{ exact: true }}
					>
						<FolderTreeIcon className="size-4" />
						Workspace
					</Link>
				</nav>
				<Separator />
				<div className="flex items-center justify-between gap-1 px-3 py-2">
					<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						Projects
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="size-6"
						aria-label="New project"
						onClick={() => {
							onOpenChange(false);
							onNewProject();
						}}
					>
						<PlusIcon className="size-3.5" />
					</Button>
				</div>
				<ScrollArea className="flex-1">
					{projectsQuery.isPending ? (
						<div className="px-3 py-2 text-xs text-muted-foreground">
							Loading…
						</div>
					) : projectsQuery.isError ? (
						<div className="px-3 py-2 text-xs text-destructive">
							Couldn't load projects
						</div>
					) : (
						<ProjectList
							projects={projectsQuery.data ?? []}
							activeProjectId={params.projectId}
							empty="No projects yet."
							onSelect={() => onOpenChange(false)}
						/>
					)}
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}

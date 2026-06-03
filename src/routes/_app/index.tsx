import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	FolderPlusIcon,
	UploadIcon,
	UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { CreateProjectDialog } from "#/components/workspace/create-project-dialog";
import { ImportProjectDialog } from "#/components/workspace/import-project-dialog";
import { InviteMemberDialog } from "#/components/workspace/invite-member-dialog";
import { TutorialCard } from "#/components/workspace/tutorial-card";
import { useActiveWorkspaceId } from "#/lib/active-workspace";
import { useMergedProjects } from "#/lib/sync/merge-projects";
import { listMyWorkspaces, listProjects } from "#/server/workspace.ts";

// Beginner-friendly tutorial CTA is prominent while the workspace is sparse
// (0-2 projects). Past that, the user has presumably found their footing and
// the card collapses into a small hint to keep the home page focused.
const TUTORIAL_PROMINENT_THRESHOLD = 3;

export const Route = createFileRoute("/_app/")({
	component: WorkspaceHome,
});

function WorkspaceHome() {
	const [createOpen, setCreateOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [inviteOpen, setInviteOpen] = useState(false);
	const activeWorkspaceId = useActiveWorkspaceId();
	const workspacesQuery = useQuery({
		queryKey: ["my-workspaces"],
		queryFn: () => listMyWorkspaces(),
	});
	const projectsQuery = useQuery({
		queryKey: ["projects", activeWorkspaceId],
		queryFn: () =>
			listProjects({
				data: activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {},
			}),
	});
	// Union server projects with offline-created ones so a project shows up the
	// instant it's created and persists in the list while offline.
	const projects = useMergedProjects(
		projectsQuery.data ?? [],
		activeWorkspaceId,
	);
	// Resolve the workspace independently of the projects list so a fresh
	// (empty) workspace still wires the Invite button.
	const workspaces = workspacesQuery.data ?? [];
	const workspaceId =
		(activeWorkspaceId &&
			workspaces.find((w) => w.workspaceId === activeWorkspaceId)
				?.workspaceId) ||
		workspaces[0]?.workspaceId ||
		projects[0]?.workspaceId;
	const showTutorialProminent =
		!projectsQuery.isPending && projects.length < TUTORIAL_PROMINENT_THRESHOLD;

	return (
		<div className="mx-auto flex h-full max-w-3xl flex-col gap-8 overflow-y-auto p-10">
			<header className="space-y-2">
				<p className="text-xs uppercase tracking-wide text-muted-foreground">
					Workspace
				</p>
				<h1 className="text-3xl font-semibold tracking-tight">
					Plan something nested.
				</h1>
				<p className="max-w-prose text-sm text-muted-foreground">
					Create a project to spin up its own Automerge document. Invite
					collaborators by email — anything they edit converges live.
				</p>
				<div className="flex flex-wrap gap-2 pt-2">
					<Button onClick={() => setCreateOpen(true)}>
						<FolderPlusIcon className="size-4" />
						New project
					</Button>
					<Button
						variant="secondary"
						onClick={() => setImportOpen(true)}
						data-testid="workspace-import-project"
					>
						<UploadIcon className="size-4" />
						Import project
					</Button>
					<Button
						variant="secondary"
						onClick={() => setInviteOpen(true)}
						disabled={!workspaceId}
					>
						<UsersIcon className="size-4" />
						Invite collaborator
					</Button>
				</div>
			</header>

			{showTutorialProminent && <TutorialCard />}

			<section className="space-y-3">
				<h2 className="text-sm font-medium text-muted-foreground">
					Your projects
				</h2>
				{projectsQuery.isPending && projects.length === 0 ? (
					<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
						Loading projects…
					</div>
				) : projectsQuery.isError && projects.length === 0 ? (
					<div className="rounded-lg border bg-card p-6 text-sm text-destructive">
						Couldn't load projects.{" "}
						{projectsQuery.error instanceof Error
							? projectsQuery.error.message
							: ""}
					</div>
				) : projects.length === 0 ? (
					<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
						No projects yet — create your first one to get going.
					</div>
				) : (
					<ul className="grid gap-3">
						{projects.map((project) => (
							<li
								key={project.id}
								className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/30"
							>
								<Link
									to="/p/$projectId"
									params={{ projectId: project.id }}
									className="flex items-center justify-between gap-4"
								>
									<div className="min-w-0">
										<div className="truncate font-medium">{project.title}</div>
										<div className="text-xs text-muted-foreground">
											Created {new Date(project.createdAt).toLocaleDateString()}
										</div>
									</div>
									<ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			<CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
			<ImportProjectDialog open={importOpen} onOpenChange={setImportOpen} />
			<InviteMemberDialog
				workspaceId={workspaceId}
				open={inviteOpen}
				onOpenChange={setInviteOpen}
			/>
		</div>
	);
}

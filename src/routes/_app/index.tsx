import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	FolderPlusIcon,
	MoreHorizontalIcon,
	PencilIcon,
	UploadIcon,
	UsersIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { BranchProjectDialog } from "#/components/workspace/branch-project-dialog";
import { CreateProjectDialog } from "#/components/workspace/create-project-dialog";
import { ImportProjectDialog } from "#/components/workspace/import-project-dialog";
import { InviteMemberDialog } from "#/components/workspace/invite-member-dialog";
import { TutorialCard } from "#/components/workspace/tutorial-card";
import { useActiveWorkspaceId } from "#/lib/active-workspace";
import { useOptionalRepo } from "#/lib/automerge/provider";
import { chatDock } from "#/lib/chat-dock";
import { ensureActiveThread, getScopeKey } from "#/lib/chat-history";
import {
	createTutorialPertDoc,
	TUTORIAL_PROJECT_TITLE,
	TUTORIAL_THREAD_ID,
	TUTORIAL_THREAD_TITLE,
} from "#/lib/pert/sample-tutorial-project";
import { useMergedProjects } from "#/lib/sync/merge-projects";
import { seedSampleProject } from "#/lib/sync/seed-sample-projects";
import { useSeedSampleProjects } from "#/lib/sync/use-seed-sample-projects";
import { listMyWorkspaces, listProjects } from "#/server/workspace.ts";
import type { ProjectSummary } from "#/types/workspace";

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
		// Fall back to a *server* project's workspace — never the merged list,
		// whose offline-created entries carry a placeholder workspaceId ("").
		(projectsQuery.data ?? [])[0]?.workspaceId;
	const showTutorialProminent =
		!projectsQuery.isPending && projects.length < TUTORIAL_PROMINENT_THRESHOLD;

	const navigate = useNavigate();
	const repo = useOptionalRepo();
	// Guards against a double-click minting two tutorial projects before the
	// first one lands in the merged list.
	const startingTutorial = useRef(false);

	// The tutorial card lives on the home page, which has no active project —
	// so the assistant's edits would have nowhere to land. Route every lesson
	// through a single shared "PERT tutorial" project: reuse it if it already
	// exists, otherwise mint one seeded with a sample diagram. Then queue the
	// seed prompt and navigate into the project so the chat binds to it and
	// proposals render as usual.
	const startTutorial = useCallback(
		async (prompt: string) => {
			const existing = projects.find((p) => p.title === TUTORIAL_PROJECT_TITLE);
			let projectId = existing?.id;

			if (!projectId) {
				// Without the local repo we can't mint a doc — fall back to opening
				// the chat with the prompt (it'll show the no-project state, but the
				// prompt isn't lost).
				if (!repo || startingTutorial.current) {
					chatDock.startWith(prompt, { autoSend: true });
					return;
				}
				startingTutorial.current = true;
				try {
					projectId = await seedSampleProject(
						repo,
						createTutorialPertDoc(TUTORIAL_PROJECT_TITLE),
						TUTORIAL_PROJECT_TITLE,
						activeWorkspaceId ?? undefined,
					);
				} finally {
					startingTutorial.current = false;
				}
			}

			// Pin a single reserved "Tutorial" thread active in the project's scope
			// before navigating. Without this the freshly-created tutorial project
			// has no threads, so the chat panel mounts with no active thread, never
			// renders a ChatThread to receive the queued prompt, and the lesson is
			// lost. Reusing one thread also means repeated lessons continue the same
			// conversation instead of spawning a new tab each time.
			const scopeKey = getScopeKey(projectId);
			if (scopeKey) {
				ensureActiveThread(scopeKey, {
					id: TUTORIAL_THREAD_ID,
					title: TUTORIAL_THREAD_TITLE,
				});
			}

			// Queue the seed first so the chat (which binds to the project on the
			// next route) auto-sends it once mounted.
			chatDock.startWith(prompt, { autoSend: true });
			navigate({ to: "/p/$projectId", params: { projectId } });
		},
		[projects, repo, activeWorkspaceId, navigate],
	);

	// First visit to an empty workspace: silently seed the sample projects (PERT
	// tutorial + Monte Carlo risk sample) so the user lands on something to
	// explore instead of a blank slate.
	useSeedSampleProjects({
		repo,
		projects,
		projectsSettled: projectsQuery.isSuccess && !projectsQuery.isError,
		workspaceId,
	});

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

			{showTutorialProminent && (
				<TutorialCard onStart={(prompt) => void startTutorial(prompt)} />
			)}

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
							<ProjectCard key={project.id} project={project} />
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

function ProjectCard({ project }: { project: ProjectSummary }) {
	const [renameOpen, setRenameOpen] = useState(false);
	// Offline-created projects (still in the local pending queue, not yet
	// registered server-side) surface with an empty `createdBy` — editing them
	// would hit `updateProjectMeta` before the row exists. Real server rows
	// always carry a creator, so that's our "safe to edit" signal. The card
	// flips to editable on its own once the reconcile loop registers it.
	const canEdit = project.createdBy !== "";

	return (
		<li className="flex min-w-0 items-center gap-2 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/30">
			<Link
				to="/p/$projectId"
				params={{ projectId: project.id }}
				className="flex min-w-0 flex-1 items-center justify-between gap-4"
			>
				<div className="min-w-0">
					<div className="truncate font-medium">{project.title}</div>
					{project.description ? (
						<div className="truncate text-xs text-muted-foreground">
							{project.description}
						</div>
					) : null}
					<div className="text-xs text-muted-foreground">
						Created {new Date(project.createdAt).toLocaleDateString()}
					</div>
				</div>
				<ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
			</Link>
			{canEdit && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="size-8 shrink-0 text-muted-foreground"
							data-testid="project-card-menu"
							title="Rename / edit description"
						>
							<MoreHorizontalIcon className="size-4" />
							<span className="sr-only">Project options</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onSelect={() => setRenameOpen(true)}
							data-testid="project-card-rename-action"
						>
							<PencilIcon className="size-3.5" />
							Rename / edit description
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
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
						isBranch: project.parentProjectId != null,
					}}
				/>
			)}
		</li>
	);
}

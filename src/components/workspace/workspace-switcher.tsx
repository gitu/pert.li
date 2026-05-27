import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckIcon,
	ChevronsUpDownIcon,
	FolderTreeIcon,
	PlusIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { activeWorkspace, useActiveWorkspaceId } from "#/lib/active-workspace";
import { listMyWorkspaces } from "#/server/workspace.ts";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

// Dropdown in the top bar. Lists every workspace the user belongs to, marks
// the active one, lets them switch (cheap — just flips localStorage and
// invalidates the projects query), and exposes a Create new entry.
export function WorkspaceSwitcher() {
	const [createOpen, setCreateOpen] = useState(false);
	const activeId = useActiveWorkspaceId();
	const queryClient = useQueryClient();
	const workspacesQuery = useQuery({
		queryKey: ["my-workspaces"],
		queryFn: () => listMyWorkspaces(),
	});

	const workspaces = workspacesQuery.data ?? [];
	// Resolve the active workspace: explicit selection wins, otherwise fall
	// back to the first one in the list (which is the auto-created personal
	// workspace for fresh accounts).
	const resolved =
		workspaces.find((w) => w.workspaceId === activeId) ?? workspaces[0];

	const switchTo = (workspaceId: string) => {
		if (workspaceId === resolved?.workspaceId) return;
		activeWorkspace.set(workspaceId);
		queryClient.invalidateQueries({ queryKey: ["projects"] });
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="gap-2 text-sm font-medium"
						data-testid="workspace-switcher-trigger"
					>
						<FolderTreeIcon className="size-4 text-muted-foreground" />
						<span className="max-w-[16ch] truncate">
							{resolved?.name ?? "Workspace"}
						</span>
						<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="min-w-56">
					<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
						Workspaces
					</DropdownMenuLabel>
					{workspacesQuery.isPending ? (
						<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
					) : workspaces.length === 0 ? (
						<DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
					) : (
						workspaces.map((w) => {
							const isActive = w.workspaceId === resolved?.workspaceId;
							return (
								<DropdownMenuItem
									key={w.workspaceId}
									onClick={() => switchTo(w.workspaceId)}
									data-testid="workspace-switcher-item"
								>
									<FolderTreeIcon className="size-4 text-muted-foreground" />
									<span className="min-w-0 flex-1 truncate">{w.name}</span>
									<span className="text-xs text-muted-foreground">
										{w.role}
									</span>
									{isActive && <CheckIcon className="size-3.5" />}
								</DropdownMenuItem>
							);
						})
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setCreateOpen(true)}
						data-testid="workspace-switcher-create"
					>
						<PlusIcon className="size-4" />
						Create new workspace
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
		</>
	);
}

import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu";
import { useOptionalRepo } from "#/lib/automerge/provider";
import { syncAllProjects } from "#/lib/sync/sync-all";
import { useOnlineStatus } from "#/lib/use-online-status";
import { listMyWorkspaces, listProjects } from "#/server/workspace.ts";

// "loading" = the browser Automerge repo hasn't finished booting yet (distinct
// from "offline", so we don't mislabel a momentary startup as no connection).
export type SyncNowState = "idle" | "syncing" | "offline" | "loading";

// Presentational menu item. Kept free of repo/network deps so Storybook can
// exercise every state directly.
export function SyncNowItemView({
	state,
	onSelect,
}: {
	state: SyncNowState;
	onSelect: () => void;
}) {
	const disabled = state !== "idle";
	return (
		<DropdownMenuItem
			disabled={disabled}
			data-testid="topbar-sync-all"
			// Keep the menu open while a sync is kicked off / in flight so the
			// disabled+spinner state is visible instead of the menu snapping shut.
			onSelect={(e) => {
				e.preventDefault();
				if (state === "idle") onSelect();
			}}
		>
			{state === "syncing" ? (
				<Loader2Icon className="size-4 animate-spin" />
			) : (
				<RefreshCwIcon className="size-4" />
			)}
			Sync all projects
			{state === "offline" && (
				<span className="ml-auto text-xs text-muted-foreground">Offline</span>
			)}
		</DropdownMenuItem>
	);
}

// Container: wires the live repo + online status, runs the sweep on click, and
// reports progress via a promise toast.
export function SyncNowItem() {
	const repo = useOptionalRepo();
	const online = useOnlineStatus();
	const [syncing, setSyncing] = useState(false);

	// Offline → the sync server can't hand anything back. No repo yet → still
	// booting; surface that as a distinct disabled "loading" rather than
	// mislabelling it "Offline".
	const state: SyncNowState = syncing
		? "syncing"
		: !online
			? "offline"
			: !repo
				? "loading"
				: "idle";

	const onSelect = () => {
		if (!repo || syncing) return;
		setSyncing(true);
		// repo.find() resolves once a doc is found locally or pulled from the
		// sync server; allSettled inside syncAllProjects keeps a single failed
		// doc from rejecting the whole sweep.
		const run = syncAllProjects({
			listWorkspaces: () => listMyWorkspaces(),
			listProjects: (workspaceId) => listProjects({ data: { workspaceId } }),
			find: (url) => repo.find(url),
		}).finally(() => setSyncing(false));

		toast.promise(run, {
			loading: "Syncing all projects…",
			success: ({ synced, projects }) =>
				synced === projects
					? `Synced ${synced} project${synced === 1 ? "" : "s"} from the server`
					: `Synced ${synced} of ${projects} projects`,
			error: "Couldn’t sync projects",
		});
	};

	return <SyncNowItemView state={state} onSelect={onSelect} />;
}

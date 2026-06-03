// Offline / sync status indicator for the top bar. Shows nothing when online
// with everything synced; otherwise surfaces an offline badge, a "syncing…"
// spinner, a pending count, or a destructive "failed to sync" badge that opens
// a popover with per-project reasons and Retry / Discard actions.

import {
	CheckIcon,
	CloudOffIcon,
	LoaderIcon,
	RotateCwIcon,
	TrashIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import type { PendingProject } from "#/lib/sync/pending-projects";
import { removePending, usePendingProjects } from "#/lib/sync/pending-projects";
import { requestRetry } from "#/lib/sync/reconcile-pending";
import { useOnlineStatus } from "#/lib/use-online-status";

export type SyncStatusViewProps = {
	online: boolean;
	items: PendingProject[];
	onRetry: (localId: string) => void;
	onDiscard: (localId: string) => void;
};

function reasonText(item: PendingProject): string {
	if (item.lastErrorKind === "terminal") {
		return item.lastError ?? "You don't have access to sync this project.";
	}
	if (item.status === "error") {
		return item.lastError ?? "Sync failed after several attempts.";
	}
	return "";
}

// Pure, prop-driven view — exercised directly by Storybook across states.
export function SyncStatusView({
	online,
	items,
	onRetry,
	onDiscard,
}: SyncStatusViewProps) {
	const active = items.filter((i) => i.status !== "registered");
	const errors = active.filter((i) => i.status === "error");
	const syncing = active.some((i) => i.status === "registering");
	const waiting = active.filter(
		(i) => i.status === "pending" || i.status === "registering",
	);

	// Nothing to report: online and the queue is drained.
	if (online && active.length === 0) return null;

	const { label, icon, variant } = (() => {
		if (errors.length > 0) {
			return {
				label: `${errors.length} failed to sync`,
				icon: <TriangleAlertIcon className="size-3.5" />,
				variant: "destructive" as const,
			};
		}
		if (!online) {
			return {
				label:
					waiting.length > 0
						? `Offline · ${waiting.length} pending`
						: "Offline",
				icon: <CloudOffIcon className="size-3.5" />,
				variant: "secondary" as const,
			};
		}
		if (syncing) {
			return {
				label: "Syncing…",
				icon: <LoaderIcon className="size-3.5 animate-spin" />,
				variant: "secondary" as const,
			};
		}
		return {
			label: `${waiting.length} pending sync`,
			icon: <LoaderIcon className="size-3.5" />,
			variant: "secondary" as const,
		};
	})();

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button type="button" data-testid="sync-status-trigger">
					<Badge
						variant={variant}
						className="cursor-pointer gap-1"
						data-testid="sync-status-badge"
					>
						{icon}
						<span className="hidden sm:inline">{label}</span>
					</Badge>
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="border-b px-3 py-2 text-sm font-medium">
					Sync status
				</div>
				<ul className="max-h-72 divide-y overflow-y-auto">
					{active.length === 0 ? (
						<li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
							<CheckIcon className="size-4 text-emerald-500" />
							All projects synced.
						</li>
					) : (
						active.map((item) => (
							<li
								key={item.localId}
								className="px-3 py-3 text-sm"
								data-testid={`sync-row-${item.localId}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate font-medium">{item.title}</span>
									{item.status === "error" ? (
										<span className="shrink-0 text-xs font-medium text-destructive">
											Failed
										</span>
									) : !online ? (
										<span className="shrink-0 text-xs text-muted-foreground">
											Waiting
										</span>
									) : item.status === "registering" ? (
										<span className="shrink-0 text-xs text-muted-foreground">
											Syncing…
										</span>
									) : (
										<span className="shrink-0 text-xs text-muted-foreground">
											Pending
										</span>
									)}
								</div>
								{item.status === "error" && (
									<p className="mt-1 text-xs text-muted-foreground">
										{reasonText(item)}
									</p>
								)}
								{!online && item.status !== "error" && (
									<p className="mt-1 text-xs text-muted-foreground">
										Will sync automatically when you're back online.
									</p>
								)}
								{item.status === "error" && (
									<div className="mt-2 flex gap-2">
										<Button
											size="sm"
											variant="secondary"
											className="h-7 gap-1 text-xs"
											onClick={() => onRetry(item.localId)}
											data-testid={`sync-retry-${item.localId}`}
										>
											<RotateCwIcon className="size-3.5" />
											Retry now
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
											onClick={() => onDiscard(item.localId)}
											data-testid={`sync-discard-${item.localId}`}
										>
											<TrashIcon className="size-3.5" />
											Discard
										</Button>
									</div>
								)}
							</li>
						))
					)}
				</ul>
			</PopoverContent>
		</Popover>
	);
}

// Container: wires live online status + the pending queue + retry/discard.
export function SyncStatus() {
	const online = useOnlineStatus();
	const items = usePendingProjects();
	return (
		<SyncStatusView
			online={online}
			items={items}
			onRetry={(localId) => void requestRetry(localId)}
			onDiscard={(localId) => {
				// Discarding an unsynced project removes it from this device only.
				// Confirm so an accidental click can't quietly drop offline work.
				const ok =
					typeof window === "undefined"
						? true
						: window.confirm(
								"Discard this project? It hasn't synced, so it will be permanently removed from this device.",
							);
				if (ok) void removePending(localId);
			}}
		/>
	);
}

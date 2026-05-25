import { useStore } from "@tanstack/react-store";
import { peersOnTask, presenceStore } from "#/lib/automerge/presence-store";
import { actorColor } from "#/lib/pert/actor-format";
import type { TaskId } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Tiny coloured circle (one per peer) showing whose selection is on the
// task. Colour comes from a deterministic hash of the userId so a given
// collaborator stays the same colour across the canvas, table, timeline,
// matrix — and across reloads.

export type PresenceBadgeProps = {
	taskId: TaskId;
	className?: string;
	max?: number;
};

export function PresenceBadge({
	taskId,
	className,
	max = 3,
}: PresenceBadgeProps) {
	const peers = useStore(presenceStore, (s) => peersOnTask(s, taskId));
	if (peers.length === 0) return null;
	const shown = peers.slice(0, max);
	const overflow = peers.length - shown.length;
	return (
		<div
			className={cn("flex items-center -space-x-1.5", className)}
			data-testid={`presence-badge-${taskId}`}
		>
			{shown.map((p) => (
				<span
					key={p.peerId}
					className="grid size-4 place-items-center rounded-full border border-background text-[8px] font-semibold text-white shadow-sm"
					style={{ backgroundColor: actorColor(p.userId) }}
					title={p.displayName || `Peer ${p.userId.slice(0, 6)}`}
				>
					{initials(p.displayName, p.userId)}
				</span>
			))}
			{overflow > 0 && (
				<span className="grid size-4 place-items-center rounded-full border border-background bg-muted text-[8px] font-semibold text-muted-foreground shadow-sm">
					+{overflow}
				</span>
			)}
		</div>
	);
}

function initials(displayName: string | null, userId: string): string {
	const source = displayName?.trim() || userId;
	const parts = source.split(/\s+|@/).filter(Boolean);
	if (parts.length === 0) return "?";
	const first = parts[0][0];
	const second = parts[1]?.[0] ?? parts[0][1] ?? "";
	return (first + second).toUpperCase();
}

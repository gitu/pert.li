import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CalendarClockIcon,
	CheckIcon,
	ClipboardIcon,
	ExternalLinkIcon,
	EyeIcon,
	InfinityIcon,
	PenLineIcon,
	PlusIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import {
	createProjectShare,
	extendProjectShare,
	listProjectShares,
	revokeProjectShare,
} from "#/server/workspace";
import type { ProjectShareSummary } from "#/types/workspace";

export type ShareProjectDialogProps = {
	projectId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type ExpiryChoice = "30d" | "7d" | "1d" | "never";

const EXPIRY_OPTIONS: Array<{ value: ExpiryChoice; label: string }> = [
	{ value: "30d", label: "30 days" },
	{ value: "7d", label: "7 days" },
	{ value: "1d", label: "1 day" },
	{ value: "never", label: "No expiry" },
];

function expiryChoiceToDate(choice: ExpiryChoice): Date | null {
	const ms: Record<Exclude<ExpiryChoice, "never">, number> = {
		"30d": 30 * 24 * 60 * 60 * 1000,
		"7d": 7 * 24 * 60 * 60 * 1000,
		"1d": 24 * 60 * 60 * 1000,
	};
	if (choice === "never") return null;
	return new Date(Date.now() + ms[choice]);
}

function shareUrl(token: string): string {
	if (typeof window === "undefined") return "";
	return `${window.location.origin}/share/${token}`;
}

function formatExpiry(iso: string | null): string {
	if (!iso) return "No expiry";
	const d = new Date(iso);
	const diffMs = d.getTime() - Date.now();
	if (diffMs <= 0) return "Expired";
	const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
	if (days >= 2) return `Expires in ${days} days · ${d.toLocaleDateString()}`;
	const hours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
	return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}

export function ShareProjectDialog({
	projectId,
	open,
	onOpenChange,
}: ShareProjectDialogProps) {
	const queryClient = useQueryClient();
	const sharesKey = useMemo(() => ["project-shares", projectId], [projectId]);

	const sharesQuery = useQuery({
		queryKey: sharesKey,
		queryFn: () => listProjectShares({ data: { projectId } }),
		enabled: open,
	});

	const createMutation = useMutation({
		mutationFn: (data: {
			projectId: string;
			mode: "view" | "edit";
			expiresAt: string | null;
		}) => createProjectShare({ data }),
		onSuccess: (created) => {
			queryClient.setQueryData<ProjectShareSummary[]>(sharesKey, (prev) =>
				prev ? [created, ...prev] : [created],
			);
			navigator.clipboard
				?.writeText(shareUrl(created.token))
				.then(() => toast.success("Link copied to clipboard"))
				.catch(() => toast.success("Link created"));
		},
		onError: (err) =>
			toast.error(err instanceof Error ? err.message : "Couldn't create link"),
	});

	const revokeMutation = useMutation({
		mutationFn: (shareId: string) => revokeProjectShare({ data: { shareId } }),
		onMutate: async (shareId) => {
			await queryClient.cancelQueries({ queryKey: sharesKey });
			const previous =
				queryClient.getQueryData<ProjectShareSummary[]>(sharesKey);
			queryClient.setQueryData<ProjectShareSummary[]>(
				sharesKey,
				(prev) => prev?.filter((s) => s.id !== shareId) ?? [],
			);
			return { previous };
		},
		onError: (err, _shareId, ctx) => {
			if (ctx?.previous) queryClient.setQueryData(sharesKey, ctx.previous);
			toast.error(err instanceof Error ? err.message : "Couldn't revoke link");
		},
		onSuccess: () => toast.success("Link revoked"),
	});

	const extendMutation = useMutation({
		mutationFn: (data: { shareId: string; expiresAt: string | null }) =>
			extendProjectShare({ data }),
		onSuccess: (updated) => {
			queryClient.setQueryData<ProjectShareSummary[]>(
				sharesKey,
				(prev) =>
					prev?.map((s) => (s.id === updated.id ? updated : s)) ?? [updated],
			);
			toast.success(
				updated.expiresAt
					? `Extended to ${new Date(updated.expiresAt).toLocaleDateString()}`
					: "Link is now permanent",
			);
		},
		onError: (err) =>
			toast.error(err instanceof Error ? err.message : "Couldn't extend link"),
	});

	const [newMode, setNewMode] = useState<"view" | "edit">("view");
	const [newExpiry, setNewExpiry] = useState<ExpiryChoice>("30d");

	const onCreate = () => {
		const expiresAt = expiryChoiceToDate(newExpiry);
		createMutation.mutate({
			projectId,
			mode: newMode,
			expiresAt: expiresAt ? expiresAt.toISOString() : null,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Share this project</DialogTitle>
					<DialogDescription>
						Anyone with a link can open the project without signing in. Edit
						links let them collaborate live; view links keep them read-only.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="share-mode">Access</Label>
							<Select
								value={newMode}
								onValueChange={(v) => setNewMode(v as "view" | "edit")}
							>
								<SelectTrigger id="share-mode" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="view">
										<span className="flex items-center gap-2">
											<EyeIcon className="size-3.5" /> View only
										</span>
									</SelectItem>
									<SelectItem value="edit">
										<span className="flex items-center gap-2">
											<PenLineIcon className="size-3.5" /> Can edit
										</span>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="share-expiry">Expires</Label>
							<Select
								value={newExpiry}
								onValueChange={(v) => setNewExpiry(v as ExpiryChoice)}
							>
								<SelectTrigger id="share-expiry" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{EXPIRY_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<Button
						type="button"
						className="w-full gap-2"
						onClick={onCreate}
						disabled={createMutation.isPending}
						data-testid="create-share-link"
					>
						<PlusIcon className="size-4" />
						{createMutation.isPending ? "Creating…" : "Create share link"}
					</Button>
				</div>

				<Separator />

				<div className="space-y-2">
					<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Active links
					</div>
					{sharesQuery.isPending ? (
						<div className="text-sm text-muted-foreground">Loading…</div>
					) : sharesQuery.data && sharesQuery.data.length > 0 ? (
						<ul className="space-y-2">
							{sharesQuery.data.map((share) => (
								<ShareRow
									key={share.id}
									share={share}
									onRevoke={() => revokeMutation.mutate(share.id)}
									onExtend={(choice) => {
										const date = expiryChoiceToDate(choice);
										extendMutation.mutate({
											shareId: share.id,
											expiresAt: date ? date.toISOString() : null,
										});
									}}
								/>
							))}
						</ul>
					) : (
						<div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
							No active share links.
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
					>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ShareRow({
	share,
	onRevoke,
	onExtend,
}: {
	share: ProjectShareSummary;
	onRevoke: () => void;
	onExtend: (choice: ExpiryChoice) => void;
}) {
	const [copied, setCopied] = useState(false);
	const url = shareUrl(share.token);
	const copy = () => {
		if (!navigator.clipboard) return;
		void navigator.clipboard.writeText(url).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};
	return (
		<li className="rounded-md border bg-card p-2.5 text-sm">
			<div className="flex items-center gap-2">
				<Badge
					variant={share.mode === "edit" ? "default" : "secondary"}
					className="gap-1"
				>
					{share.mode === "edit" ? (
						<PenLineIcon className="size-3" />
					) : (
						<EyeIcon className="size-3" />
					)}
					{share.mode === "edit" ? "Edit" : "View"}
				</Badge>
				<span className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
					{share.expiresAt ? (
						<>
							<CalendarClockIcon className="size-3.5" />
							{formatExpiry(share.expiresAt)}
						</>
					) : (
						<>
							<InfinityIcon className="size-3.5" />
							No expiry
						</>
					)}
				</span>
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					className="text-muted-foreground hover:text-foreground"
					aria-label="Open share link"
				>
					<ExternalLinkIcon className="size-3.5" />
				</a>
			</div>
			<div className="mt-2 flex items-center gap-1.5">
				<code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
					{url}
				</code>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-7"
					onClick={copy}
					aria-label="Copy link"
				>
					{copied ? (
						<CheckIcon className="size-3.5" />
					) : (
						<ClipboardIcon className="size-3.5" />
					)}
				</Button>
				<ExtendMenu onExtend={onExtend} />
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-7 text-destructive hover:text-destructive"
					onClick={onRevoke}
					aria-label="Revoke link"
				>
					<Trash2Icon className="size-3.5" />
				</Button>
			</div>
		</li>
	);
}

function ExtendMenu({
	onExtend,
}: {
	onExtend: (choice: ExpiryChoice) => void;
}) {
	// Inline select rather than a popover/dropdown — keeps the row layout
	// stable and avoids two layers of portals when the dialog is already a
	// portal. The trigger reads "Extend" but the chosen value applies
	// instantly via onValueChange.
	return (
		<Select value="" onValueChange={(v) => onExtend(v as ExpiryChoice)}>
			<SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs">
				<RotateCcwIcon className="size-3.5" />
				<span>Extend</span>
			</SelectTrigger>
			<SelectContent align="end">
				{EXPIRY_OPTIONS.map((opt) => (
					<SelectItem key={opt.value} value={opt.value}>
						{opt.label === "No expiry" ? "Make permanent" : `+${opt.label}`}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

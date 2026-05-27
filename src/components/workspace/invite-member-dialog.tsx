import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	createJoinLink,
	inviteMember,
	listJoinLinks,
	revokeJoinLink,
} from "#/server/workspace.ts";
import type {
	JoinLinkRole,
	WorkspaceInvitationSummary,
} from "#/types/workspace";

export type InviteMemberDialogProps = {
	workspaceId: string | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

// Only "editor" is surfaced in the UI: "viewer" was removed when we found
// the sync server couldn't actually enforce read-only access (Automerge has
// no read-only peer mode); promotion to "owner" stays a deliberate manual
// step rather than a dropdown option.
type Role = "editor";

export function InviteMemberDialog({
	workspaceId,
	open,
	onOpenChange,
}: InviteMemberDialogProps) {
	// Each open cycle gets a fresh epoch. Used as the React key on Tabs so the
	// EmailInvitePane / ShareLinkPane subtrees remount on every open, wiping
	// transient state (input values, success/error toasts) from the previous
	// session. Closing via Esc / outside-click triggers onOpenChange just like
	// the explicit Close button, so the reset is unconditional.
	const [openEpoch, setOpenEpoch] = useState(0);
	useEffect(() => {
		if (open) setOpenEpoch((n) => n + 1);
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Invite collaborators</DialogTitle>
					<DialogDescription>
						Add a registered user by email, or share a join link anyone can use.
					</DialogDescription>
				</DialogHeader>
				<Tabs key={openEpoch} defaultValue="link" className="gap-3">
					<TabsList className="w-full">
						<TabsTrigger value="link" className="flex-1">
							Share link
						</TabsTrigger>
						<TabsTrigger value="email" className="flex-1">
							By email
						</TabsTrigger>
					</TabsList>
					<TabsContent value="link" className="mt-0">
						<ShareLinkPane
							workspaceId={workspaceId}
							onClose={() => onOpenChange(false)}
						/>
					</TabsContent>
					<TabsContent value="email" className="mt-0">
						<EmailInvitePane
							workspaceId={workspaceId}
							onClose={() => onOpenChange(false)}
						/>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}

function EmailInvitePane({
	workspaceId,
	onClose,
}: {
	workspaceId: string | undefined;
	onClose: () => void;
}) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("editor");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: (data: { workspaceId: string; email: string; role: Role }) =>
			inviteMember({ data }),
		onSuccess: (result) => {
			setSuccess(
				result.alreadyMember
					? `${email} is already a member.`
					: `${email} added as ${role}.`,
			);
			setEmail("");
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSuccess(null);
		if (!workspaceId) {
			setError("No workspace loaded");
			return;
		}
		mutation.mutate({ workspaceId, email, role });
	};

	return (
		<form onSubmit={submit} className="space-y-4">
			<p className="text-xs text-muted-foreground">
				The user must already have signed up. For unregistered collaborators,
				share a link from the other tab.
			</p>
			<div className="space-y-2">
				<Label htmlFor="invite-email">Email</Label>
				<Input
					id="invite-email"
					type="email"
					required
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="collaborator@example.com"
					disabled={mutation.isPending || !workspaceId}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="invite-role">Role</Label>
				<Select
					value={role}
					onValueChange={(v) => setRole(v as Role)}
					disabled={mutation.isPending}
				>
					<SelectTrigger id="invite-role" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="editor">Editor — can edit projects</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{error && (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
			{success && (
				<output className="text-sm text-emerald-600">{success}</output>
			)}
			<DialogFooter>
				<Button
					type="button"
					variant="ghost"
					onClick={onClose}
					disabled={mutation.isPending}
				>
					Close
				</Button>
				<Button type="submit" disabled={mutation.isPending || !workspaceId}>
					{mutation.isPending ? "Inviting…" : "Invite"}
				</Button>
			</DialogFooter>
		</form>
	);
}

type ExpiryOption = "never" | "1d" | "7d" | "30d";
type MaxUsesOption = "unlimited" | "1" | "5" | "25";

function ShareLinkPane({
	workspaceId,
	onClose,
}: {
	workspaceId: string | undefined;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [role, setRole] = useState<JoinLinkRole>("editor");
	const [expiry, setExpiry] = useState<ExpiryOption>("7d");
	const [maxUses, setMaxUses] = useState<MaxUsesOption>("unlimited");
	const [error, setError] = useState<string | null>(null);

	const linksQuery = useQuery({
		queryKey: ["workspace-join-links", workspaceId],
		queryFn: () =>
			workspaceId
				? listJoinLinks({ data: { workspaceId } })
				: Promise.resolve([] as WorkspaceInvitationSummary[]),
		enabled: Boolean(workspaceId),
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: ["workspace-join-links", workspaceId],
		});

	const createMutation = useMutation({
		mutationFn: () => {
			if (!workspaceId) throw new Error("No workspace loaded");
			const expiresAt = expiryOptionToIso(expiry);
			const max = maxUsesOptionToNumber(maxUses);
			return createJoinLink({
				data: {
					workspaceId,
					role,
					expiresAt,
					maxUses: max,
				},
			});
		},
		onSuccess: () => {
			setError(null);
			invalidate();
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Could not create link"),
	});

	const revokeMutation = useMutation({
		mutationFn: (invitationId: string) => {
			if (!workspaceId) throw new Error("No workspace loaded");
			return revokeJoinLink({ data: { workspaceId, invitationId } });
		},
		onSuccess: () => invalidate(),
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Could not revoke link"),
	});

	const activeLinks = (linksQuery.data ?? []).filter(
		(link) => !isLinkInactive(link),
	);

	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Anyone with the link can join as an editor until you revoke it. Owner
				promotion stays manual.
			</p>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<div className="space-y-1.5">
					<Label htmlFor="link-role">Role</Label>
					<Select
						value={role}
						onValueChange={(v) => setRole(v as JoinLinkRole)}
						disabled={createMutation.isPending}
					>
						<SelectTrigger id="link-role" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="editor">Editor</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="link-expiry">Expires</Label>
					<Select
						value={expiry}
						onValueChange={(v) => setExpiry(v as ExpiryOption)}
						disabled={createMutation.isPending}
					>
						<SelectTrigger id="link-expiry" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="1d">In 1 day</SelectItem>
							<SelectItem value="7d">In 7 days</SelectItem>
							<SelectItem value="30d">In 30 days</SelectItem>
							<SelectItem value="never">Never</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="link-max-uses">Max uses</Label>
					<Select
						value={maxUses}
						onValueChange={(v) => setMaxUses(v as MaxUsesOption)}
						disabled={createMutation.isPending}
					>
						<SelectTrigger id="link-max-uses" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="unlimited">Unlimited</SelectItem>
							<SelectItem value="1">1 person</SelectItem>
							<SelectItem value="5">5 people</SelectItem>
							<SelectItem value="25">25 people</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
			<Button
				type="button"
				className="w-full"
				onClick={() => createMutation.mutate()}
				disabled={!workspaceId || createMutation.isPending}
				data-testid="create-join-link"
			>
				{createMutation.isPending ? "Creating link…" : "Generate share link"}
			</Button>
			{error && (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
			<div className="space-y-2">
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Active links
				</div>
				{linksQuery.isPending ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : activeLinks.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No active links. Generate one above.
					</p>
				) : (
					<ul className="space-y-2">
						{activeLinks.map((link) => (
							<JoinLinkRow
								key={link.id}
								link={link}
								onRevoke={() => revokeMutation.mutate(link.id)}
								revoking={
									revokeMutation.isPending &&
									revokeMutation.variables === link.id
								}
							/>
						))}
					</ul>
				)}
			</div>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={onClose}>
					Close
				</Button>
			</DialogFooter>
		</div>
	);
}

function JoinLinkRow({
	link,
	onRevoke,
	revoking,
}: {
	link: WorkspaceInvitationSummary;
	onRevoke: () => void;
	revoking: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const url =
		typeof window !== "undefined"
			? `${window.location.origin}/join/${link.token}`
			: `/join/${link.token}`;

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Browsers without clipboard permission fall through silently — the
			// input is still selectable for manual copy.
		}
	}

	return (
		<li className="flex flex-col gap-2 rounded-md border bg-background p-2 text-sm">
			<div className="flex items-center gap-2">
				<Input
					readOnly
					value={url}
					onFocus={(e) => e.currentTarget.select()}
					className="h-8 flex-1 font-mono text-xs"
					aria-label="Share link URL"
				/>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-8 shrink-0"
					onClick={copy}
					aria-label={copied ? "Copied" : "Copy link"}
				>
					{copied ? (
						<CheckIcon className="size-4 text-emerald-600" />
					) : (
						<CopyIcon className="size-4" />
					)}
				</Button>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-8 shrink-0 text-destructive hover:bg-destructive/10"
					onClick={onRevoke}
					disabled={revoking}
					aria-label="Revoke link"
				>
					<Trash2Icon className="size-4" />
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				<span className="font-medium text-foreground">{link.role}</span>
				<span>·</span>
				<span>{formatExpiry(link.expiresAt)}</span>
				<span>·</span>
				<span>{formatUsage(link.useCount, link.maxUses)}</span>
			</div>
		</li>
	);
}

function expiryOptionToIso(option: ExpiryOption): string | null {
	if (option === "never") return null;
	const days = option === "1d" ? 1 : option === "7d" ? 7 : 30;
	return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function maxUsesOptionToNumber(option: MaxUsesOption): number | null {
	return option === "unlimited" ? null : Number(option);
}

function isLinkInactive(link: WorkspaceInvitationSummary): boolean {
	if (link.revokedAt) return true;
	if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now())
		return true;
	if (link.maxUses != null && link.useCount >= link.maxUses) return true;
	return false;
}

function formatExpiry(expiresAt: string | null): string {
	if (!expiresAt) return "No expiry";
	const date = new Date(expiresAt);
	return `Expires ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function formatUsage(useCount: number, maxUses: number | null): string {
	if (maxUses == null) return `${useCount} used`;
	return `${useCount} / ${maxUses} used`;
}

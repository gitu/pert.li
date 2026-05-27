import { Link } from "@tanstack/react-router";
import { LayersIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { WorkspaceInvitationPreview } from "#/types/workspace";

export type JoinWorkspaceCardProps = {
	preview: WorkspaceInvitationPreview | null;
	sessionPending: boolean;
	hasSession: boolean;
	tokenPath: string;
	pending: boolean;
	error: string | null;
	onAccept: () => void;
};

// Presentational shell for the /join/$token page. Pulled out of the route
// file so stories can mount it without dragging in `createFileRoute` or the
// server loader.
export function JoinWorkspaceCard(props: JoinWorkspaceCardProps) {
	const { preview } = props;
	return (
		<div className="w-full max-w-md space-y-5 rounded-lg border bg-card p-6 shadow-sm">
			<div className="flex items-center gap-3">
				<div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
					<LayersIcon className="size-5" />
				</div>
				<div>
					<div className="text-sm text-muted-foreground">
						pert.li workspace invitation
					</div>
					<h1 className="text-lg font-semibold leading-tight tracking-tight">
						{preview?.workspaceName ?? "Workspace"}
					</h1>
				</div>
			</div>

			<JoinBody {...props} />

			<div className="text-center text-xs text-muted-foreground">
				<Link to="/" className="hover:text-foreground">
					← back to home
				</Link>
			</div>
		</div>
	);
}

function JoinBody({
	preview,
	sessionPending,
	hasSession,
	tokenPath,
	pending,
	error,
	onAccept,
}: JoinWorkspaceCardProps) {
	if (!preview) {
		return (
			<InvalidState
				title="Invitation not found"
				detail="This link may have a typo, or the invitation has been deleted."
			/>
		);
	}
	if (preview.invalidReason === "revoked") {
		return (
			<InvalidState
				title="Invitation revoked"
				detail="The workspace owner has revoked this link. Ask them for a new one."
			/>
		);
	}
	if (preview.invalidReason === "expired") {
		return (
			<InvalidState
				title="Invitation expired"
				detail="This link has reached its expiry date. Ask the workspace owner for a new one."
			/>
		);
	}
	if (preview.invalidReason === "exhausted") {
		return (
			<InvalidState
				title="Invitation limit reached"
				detail="This link has hit its usage cap. Ask the workspace owner for a new one."
			/>
		);
	}

	const roleLabel = preview.role === "editor" ? "editor" : "viewer";

	if (sessionPending) {
		return (
			<p className="text-sm text-muted-foreground" aria-live="polite">
				Checking your session…
			</p>
		);
	}

	if (!hasSession) {
		return (
			<>
				<p className="text-sm text-muted-foreground">
					Sign in to join <strong>{preview.workspaceName}</strong> as{" "}
					<strong>{roleLabel}</strong>. You'll come straight back to this page
					afterwards.
				</p>
				<Button asChild className="w-full">
					<Link
						to="/signin"
						search={{ callbackURL: tokenPath }}
						data-testid="join-signin-cta"
					>
						Sign in to join
					</Link>
				</Button>
			</>
		);
	}

	return (
		<>
			<p className="text-sm text-muted-foreground">
				You're about to join <strong>{preview.workspaceName}</strong> as{" "}
				<strong>{roleLabel}</strong>.
			</p>
			{error && (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
			<Button
				type="button"
				className="w-full"
				onClick={onAccept}
				disabled={pending}
				data-testid="join-accept-button"
			>
				{pending ? "Joining…" : "Join workspace"}
			</Button>
		</>
	);
}

function InvalidState({ title, detail }: { title: string; detail: string }) {
	return (
		<div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-4">
			<p className="text-sm font-medium text-destructive">{title}</p>
			<p className="text-sm text-muted-foreground">{detail}</p>
		</div>
	);
}

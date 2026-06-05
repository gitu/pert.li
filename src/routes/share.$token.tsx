import type { AnyDocumentId } from "@automerge/automerge-repo";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ClockIcon, EyeIcon, LayersIcon, PenLineIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CanvasLoading } from "#/components/canvas/canvas-loading";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Toaster } from "#/components/ui/sonner";
import { TooltipProvider } from "#/components/ui/tooltip";
import { useAppConfig } from "#/lib/app-config";
import { ShareRepoProvider } from "#/lib/automerge/provider";
import { setShareIdentity } from "#/lib/share-identity";
import { ViewModeProvider } from "#/lib/view-mode";
import { resolveProjectShare } from "#/server/workspace";
import { PertProjectPanel, type ProjectView } from "./_app/p.$projectId";

// Per-recipient display name remembered locally so subsequent visits don't
// re-prompt. Keyed by token so multiple shares in the same browser don't
// collide on the same identity.
const NAME_STORAGE_KEY = "pertli.shareName.v1";

function readShareName(token: string): string | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(`${NAME_STORAGE_KEY}:${token}`);
		return raw?.trim() ? raw : null;
	} catch {
		return null;
	}
}

function persistShareName(token: string, name: string) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(`${NAME_STORAGE_KEY}:${token}`, name);
	} catch {
		// Private browsing — degrade silently; user re-enters on next visit.
	}
}

type ShareSearch = { view?: ProjectView };

function validateShareSearch(raw: Record<string, unknown>): ShareSearch {
	const v = raw?.view;
	if (v === "timeline") return { view: "timeline" };
	if (v === "table" || v === "list") return { view: "table" };
	if (v === "matrix") return { view: "matrix" };
	if (v === "network") return { view: "network" };
	return {};
}

export const Route = createFileRoute("/share/$token")({
	component: ShareLanding,
	validateSearch: validateShareSearch,
});

function ShareLanding() {
	const { token } = Route.useParams();
	const search = useSearch({ from: "/share/$token" });
	const view: ProjectView = search.view ?? "network";

	// Resolve the token via the public server fn. `null` from the server means
	// the link is gone — we render an explanatory page rather than a 404 so
	// the recipient knows they need a fresh link from the owner.
	const resolution = useQuery({
		queryKey: ["share", token],
		queryFn: () => resolveProjectShare({ data: { token } }),
		// Don't retry a hard "no": that's the expected response for an
		// expired link.
		retry: false,
	});

	if (resolution.isPending) {
		return (
			<ShareShell>
				<CanvasLoading message="Resolving link…" />
			</ShareShell>
		);
	}
	if (resolution.isError || !resolution.data) {
		return <InvalidShare />;
	}

	const share = resolution.data;
	const isEdit = share.mode === "edit";

	return (
		<ShareShell>
			<ViewModeProvider forceReadOnly={!isEdit}>
				<ShareRepoProvider token={token}>
					<ShareCanvas
						token={token}
						projectId={share.projectId}
						documentId={share.automergeDocUrl as unknown as AnyDocumentId}
						title={share.title}
						mode={share.mode}
						expiresAt={share.expiresAt}
						view={view}
					/>
				</ShareRepoProvider>
			</ViewModeProvider>
			<Toaster />
		</ShareShell>
	);
}

function ShareShell({ children }: { children: React.ReactNode }) {
	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex h-svh w-svw flex-col bg-background">{children}</div>
		</TooltipProvider>
	);
}

function ShareCanvas({
	token,
	projectId,
	documentId,
	title,
	mode,
	expiresAt,
	view,
}: {
	token: string;
	projectId: string;
	documentId: AnyDocumentId;
	title: string;
	mode: "view" | "edit";
	expiresAt: string | null;
	view: ProjectView;
}) {
	const [displayName, setDisplayName] = useState<string | null>(() =>
		readShareName(token),
	);
	// Hydrate from localStorage once on mount (matches SSR-safe pattern).
	useEffect(() => {
		setDisplayName(readShareName(token));
	}, [token]);

	// Push the recipient's identity into the shared store so PresenceBroadcaster
	// attributes their selection to the chosen name. Cleared on unmount so a
	// subsequent navigation back into a signed-in route doesn't carry a stale
	// share name. View-mode recipients skip the broadcast entirely (no name set).
	useEffect(() => {
		if (mode === "edit" && displayName) {
			const buf = new Uint8Array(16);
			crypto.getRandomValues(buf);
			const suffix = Array.from(buf, (b) =>
				b.toString(16).padStart(2, "0"),
			).join("");
			setShareIdentity({
				displayName,
				userId: `share:${token.slice(0, 8)}:${suffix}`,
			});
		}
		return () => setShareIdentity(null);
	}, [mode, displayName, token]);

	// Edit mode without a remembered name → block the canvas behind a one-time
	// prompt. View mode skips this entirely; viewers don't push presence so
	// there's no name to attribute.
	if (mode === "edit" && !displayName) {
		return (
			<NamePrompt
				onSubmit={(name) => {
					persistShareName(token, name);
					setDisplayName(name);
				}}
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<ShareHeader title={title} mode={mode} expiresAt={expiresAt} />
			<div className="min-h-0 flex-1">
				<PertProjectPanel
					projectId={projectId}
					documentId={documentId}
					view={view}
				/>
			</div>
		</div>
	);
}

function ShareHeader({
	title,
	mode,
	expiresAt,
}: {
	title: string;
	mode: "view" | "edit";
	expiresAt: string | null;
}) {
	const { appName } = useAppConfig();
	const Icon = mode === "edit" ? PenLineIcon : EyeIcon;
	const expiry = expiresAt
		? new Date(expiresAt).toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			})
		: null;
	return (
		<header className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-card/40 px-4 py-2">
			<div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
				<LayersIcon className="size-4" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium">{title}</div>
				<div className="text-xs text-muted-foreground">
					Shared via {appName}
				</div>
			</div>
			<span
				className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs"
				data-testid="share-mode-badge"
			>
				<Icon className="size-3.5" />
				{mode === "edit" ? "Can edit" : "View only"}
			</span>
			{expiry && (
				<span
					className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground"
					title={`Link expires ${expiry}`}
				>
					<ClockIcon className="size-3.5" />
					expires {expiry}
				</span>
			)}
		</header>
	);
}

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
	const [value, setValue] = useState("");
	const trimmed = value.trim();
	return (
		<div className="grid h-full place-items-center p-6">
			<form
				className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm"
				onSubmit={(e) => {
					e.preventDefault();
					if (trimmed) onSubmit(trimmed);
				}}
			>
				<div className="space-y-1">
					<h1 className="text-lg font-semibold">Choose a display name</h1>
					<p className="text-sm text-muted-foreground">
						Your edits will be attributed to this name for the project's
						collaborators. You can clear this from your browser storage at any
						time.
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="share-display-name">Display name</Label>
					<Input
						id="share-display-name"
						autoFocus
						required
						maxLength={64}
						placeholder="e.g. Sam from Operations"
						value={value}
						onChange={(e) => setValue(e.target.value)}
					/>
				</div>
				<Button
					type="submit"
					className="w-full"
					disabled={!trimmed}
					data-testid="share-name-submit"
				>
					Continue
				</Button>
			</form>
		</div>
	);
}

function InvalidShare() {
	const { appName } = useAppConfig();
	return (
		<ShareShell>
			<div className="grid h-full place-items-center p-6 text-center">
				<div className="max-w-sm space-y-3">
					<div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
						<LayersIcon className="size-6 text-muted-foreground" />
					</div>
					<h1 className="text-lg font-semibold">
						This link is no longer valid
					</h1>
					<p className="text-sm text-muted-foreground">
						The owner may have revoked it, or it may have expired. Ask them for
						a fresh share link.
					</p>
					<Button asChild variant="secondary" size="sm">
						<Link to="/">Go to {appName}</Link>
					</Button>
				</div>
			</div>
		</ShareShell>
	);
}

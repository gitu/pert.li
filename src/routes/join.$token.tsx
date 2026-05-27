import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { JoinWorkspaceCard } from "#/components/workspace/join-workspace-card";
import { authClient } from "#/lib/auth-client";
import { acceptJoinLink, getJoinLinkPreview } from "#/server/workspace.ts";
import type { WorkspaceInvitationPreview } from "#/types/workspace";

export const Route = createFileRoute("/join/$token")({
	component: JoinPage,
	// Run server-side so the page renders the workspace name + status before
	// any client JS — link previews in messengers show meaningful metadata,
	// and a logged-out user sees the call-to-action immediately.
	loader: ({ params }) => getJoinLinkPreview({ data: { token: params.token } }),
});

function JoinPage() {
	const params = Route.useParams();
	const preview = Route.useLoaderData() as WorkspaceInvitationPreview | null;
	const { data: session, isPending } = authClient.useSession();
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);

	const accept = useMutation({
		mutationFn: () => acceptJoinLink({ data: { token: params.token } }),
		onSuccess: () => {
			navigate({ to: "/" });
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Could not join workspace"),
	});

	return (
		<div className="min-h-svh grid place-items-center bg-background p-6">
			<JoinWorkspaceCard
				preview={preview}
				sessionPending={isPending}
				hasSession={Boolean(session)}
				tokenPath={`/join/${params.token}`}
				pending={accept.isPending}
				error={error}
				onAccept={() => {
					setError(null);
					accept.mutate();
				}}
			/>
		</div>
	);
}

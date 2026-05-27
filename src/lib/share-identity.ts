import { Store } from "@tanstack/store";

// Identity for the public /share/$token route. The signed-in identity from
// Better Auth is unavailable on that path, so this store is the only source
// of "who is this user" for presence + future audit hooks. Live mutations
// flow through `setShareIdentity` (called once the recipient submits the
// name prompt); presence consumers read via `useShareIdentity`.

export type ShareIdentity = {
	// Display name shown to authenticated collaborators editing alongside.
	displayName: string;
	// Stable per-tab id so the presence overlay differentiates two anonymous
	// recipients editing the same project. Randomized client-side; not
	// persisted, so a new tab = a new id.
	userId: string;
};

export const shareIdentityStore = new Store<ShareIdentity | null>(null);

export function setShareIdentity(identity: ShareIdentity | null) {
	shareIdentityStore.setState(() => identity);
}

export function getShareIdentity(): ShareIdentity | null {
	return shareIdentityStore.state;
}

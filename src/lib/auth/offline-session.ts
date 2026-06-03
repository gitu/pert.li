// Offline-tolerant session layer over Better Auth's useSession().
//
// authClient.useSession() re-fetches /api/auth/get-session on every mount, so
// offline it resolves to "no session" and the app shell redirects to /signin —
// locking a previously-authenticated user out of their local (IndexedDB-backed)
// projects. Here we cache the *identity only* (no tokens) on every successful
// resolve and, when offline, fall back to it so the shell renders. Nothing
// server-authoritative is granted offline: server fns still gate on the real
// cookie; this only governs whether the client shell unlocks.

import { useEffect } from "react";
import { authClient } from "#/lib/auth-client";

const IDENTITY_KEY = "pert.li:last-identity";

// The minimal identity the shell needs (TopBar avatar, admin nav, profile
// prompt). Deliberately excludes anything sensitive.
export type CachedIdentity = {
	id: string;
	email: string;
	name?: string | null;
	image?: string | null;
	isAdmin?: boolean;
};

export type OfflineSessionSource = "live" | "offline" | "pending" | "none";

export type OfflineSession = {
	// Mirrors the relevant shape of Better Auth's session.data so callers can
	// read `data.user` exactly as before.
	data: { user: CachedIdentity } | null;
	isPending: boolean;
	source: OfflineSessionSource;
};

export function readCachedIdentity(): CachedIdentity | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(IDENTITY_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed.id === "string" &&
			typeof parsed.email === "string"
		) {
			return parsed as CachedIdentity;
		}
	} catch {
		// Corrupt entry — treat as no cache.
	}
	return null;
}

export function writeCachedIdentity(identity: CachedIdentity): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
	} catch {
		// Storage full / disabled — non-fatal, we just lose offline fallback.
	}
}

export function clearCachedIdentity(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(IDENTITY_KEY);
	} catch {
		// ignore
	}
}

// Pure decision core — easy to unit test across the (live, pending, online,
// cached) matrix without mocking the auth client or navigator.
export function resolveSession(input: {
	live: { user: CachedIdentity } | null;
	isPending: boolean;
	online: boolean;
	cached: CachedIdentity | null;
}): OfflineSession {
	if (input.live) return { data: input.live, isPending: false, source: "live" };

	// Offline with a remembered identity → unlock the shell immediately, whether
	// the live check is still pending or already came back empty (it will have
	// failed at the network layer).
	if (!input.online && input.cached) {
		return {
			data: { user: input.cached },
			isPending: false,
			source: "offline",
		};
	}

	if (input.isPending)
		return { data: null, isPending: true, source: "pending" };
	return { data: null, isPending: false, source: "none" };
}

function isOnline(): boolean {
	return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOfflineSession(): OfflineSession {
	const { data, isPending } = authClient.useSession();
	const liveUser = (data?.user as CachedIdentity | undefined) ?? null;

	// Persist the identity whenever a live session is present so it's available
	// the next time we boot offline.
	useEffect(() => {
		if (liveUser) {
			writeCachedIdentity({
				id: liveUser.id,
				email: liveUser.email,
				name: liveUser.name,
				image: liveUser.image,
				isAdmin: liveUser.isAdmin,
			});
		}
	}, [liveUser]);

	return resolveSession({
		live: liveUser ? { user: liveUser } : null,
		isPending,
		online: isOnline(),
		cached: readCachedIdentity(),
	});
}

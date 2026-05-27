import { getRequest } from "@tanstack/react-start/server";
import { auth } from "#/lib/auth.server.ts";

export class UnauthorizedError extends Error {
	status = 401;
	constructor(message = "Unauthorized") {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class ForbiddenError extends Error {
	status = 403;
	constructor(message = "Forbidden") {
		super(message);
		this.name = "ForbiddenError";
	}
}

export type AuthSession = {
	userId: string;
	email: string;
	name: string | null;
	isAdmin: boolean;
};

// Validates a Better Auth session from raw request headers. Used by
// `requireSession` (which reads them from the ambient TanStack Start
// request) and by route handlers that already have the request in hand
// (e.g. `server.handlers` POST handlers like `/api/chat`).
export async function requireSessionFromHeaders(
	headers: Headers,
): Promise<AuthSession> {
	const session = await auth.api.getSession({ headers }).catch(() => null);
	if (!session?.user?.id) throw new UnauthorizedError();
	// `isAdmin` is declared as an additional user field on the Better Auth
	// instance, but it isn't part of the base typed user shape — read it
	// defensively. Anything falsy collapses to false.
	const sessionUser = session.user as { isAdmin?: unknown };
	return {
		userId: session.user.id,
		email: session.user.email,
		name: session.user.name ?? null,
		isAdmin: sessionUser.isAdmin === true,
	};
}

export async function requireSession(): Promise<AuthSession> {
	const req = getRequest();
	return requireSessionFromHeaders(req.headers);
}

export async function requireAdmin(): Promise<{
	userId: string;
	email: string;
	name: string | null;
	isAdmin: true;
}> {
	const session = await requireSession();
	if (!session.isAdmin) throw new ForbiddenError("Admin access required");
	return { ...session, isAdmin: true };
}

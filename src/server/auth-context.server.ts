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

export async function requireSession(): Promise<{
	userId: string;
	email: string;
	name: string | null;
	isAdmin: boolean;
}> {
	const req = getRequest();
	const session = await auth.api
		.getSession({ headers: req.headers })
		.catch(() => null);
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

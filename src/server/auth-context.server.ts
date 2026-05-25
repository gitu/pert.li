import { getRequest } from "@tanstack/react-start/server";
import { auth } from "#/lib/auth.server.ts";

export class UnauthorizedError extends Error {
	status = 401;
	constructor(message = "Unauthorized") {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export async function requireSession(): Promise<{
	userId: string;
	email: string;
	name: string | null;
}> {
	const req = getRequest();
	const session = await auth.api
		.getSession({ headers: req.headers })
		.catch(() => null);
	if (!session?.user?.id) throw new UnauthorizedError();
	return {
		userId: session.user.id,
		email: session.user.email,
		name: session.user.name ?? null,
	};
}

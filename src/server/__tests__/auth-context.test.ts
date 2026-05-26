import { beforeEach, describe, expect, it, vi } from "vitest";

// `auth-context.server` reads `getRequest()` (TanStack Start server helper)
// and calls `auth.api.getSession`. We mock both so we can drive the session
// shape per-test without spinning up Better Auth.
const getRequestMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@tanstack/react-start/server", () => ({
	getRequest: () => getRequestMock(),
}));
vi.mock("#/lib/auth.server.ts", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

const { requireSession, requireAdmin, UnauthorizedError, ForbiddenError } =
	await import("#/server/auth-context.server");

function setSession(value: unknown) {
	getRequestMock.mockReturnValue({ headers: new Headers() });
	getSessionMock.mockResolvedValue(value);
}

describe("auth-context", () => {
	beforeEach(() => {
		getRequestMock.mockReset();
		getSessionMock.mockReset();
	});

	describe("requireSession", () => {
		it("returns the user when authenticated", async () => {
			setSession({
				user: {
					id: "u1",
					email: "a@b.c",
					name: "Ada",
					isAdmin: false,
				},
			});
			const s = await requireSession();
			expect(s).toEqual({
				userId: "u1",
				email: "a@b.c",
				name: "Ada",
				isAdmin: false,
			});
		});

		it("surfaces isAdmin=true when the session user has it", async () => {
			setSession({
				user: { id: "u1", email: "a@b.c", isAdmin: true },
			});
			const s = await requireSession();
			expect(s.isAdmin).toBe(true);
			expect(s.name).toBeNull();
		});

		it("throws Unauthorized when no session", async () => {
			setSession(null);
			await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
		});

		it("treats a session without user.id as unauthorized", async () => {
			setSession({ user: { email: "no-id@example.com" } });
			await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
		});
	});

	describe("requireAdmin", () => {
		it("returns the admin session when isAdmin=true", async () => {
			setSession({
				user: { id: "u1", email: "a@b.c", name: null, isAdmin: true },
			});
			const s = await requireAdmin();
			expect(s.isAdmin).toBe(true);
			expect(s.userId).toBe("u1");
		});

		it("throws Forbidden for a non-admin user", async () => {
			setSession({
				user: { id: "u2", email: "user@example.com", isAdmin: false },
			});
			await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
		});

		it("throws Unauthorized when not signed in (precedes admin check)", async () => {
			setSession(null);
			await expect(requireAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
		});
	});
});

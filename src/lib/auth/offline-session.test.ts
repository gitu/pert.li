import { describe, expect, it } from "vitest";
import { type CachedIdentity, resolveSession } from "./offline-session";

const ada: CachedIdentity = { id: "u1", email: "ada@example.com", name: "Ada" };
const live = { user: ada };

describe("resolveSession", () => {
	it("prefers a live session regardless of connectivity", () => {
		expect(
			resolveSession({ live, isPending: false, online: true, cached: null })
				.source,
		).toBe("live");
		expect(
			resolveSession({ live, isPending: false, online: false, cached: ada })
				.source,
		).toBe("live");
	});

	it("falls back to the cached identity when offline", () => {
		const r = resolveSession({
			live: null,
			isPending: false,
			online: false,
			cached: ada,
		});
		expect(r.source).toBe("offline");
		expect(r.data?.user.email).toBe("ada@example.com");
		expect(r.isPending).toBe(false);
	});

	it("unlocks offline even while the live check is still pending", () => {
		const r = resolveSession({
			live: null,
			isPending: true,
			online: false,
			cached: ada,
		});
		expect(r.source).toBe("offline");
		expect(r.isPending).toBe(false);
	});

	it("stays pending while online and the live check is in flight", () => {
		const r = resolveSession({
			live: null,
			isPending: true,
			online: true,
			cached: ada,
		});
		expect(r.source).toBe("pending");
		expect(r.isPending).toBe(true);
		expect(r.data).toBeNull();
	});

	it("reports no session when online with no live session (→ redirect to signin)", () => {
		const r = resolveSession({
			live: null,
			isPending: false,
			online: true,
			cached: ada,
		});
		expect(r.source).toBe("none");
		expect(r.data).toBeNull();
	});

	it("reports no session when offline but nothing was ever cached", () => {
		const r = resolveSession({
			live: null,
			isPending: false,
			online: false,
			cached: null,
		});
		expect(r.source).toBe("none");
	});
});

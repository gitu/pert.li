import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	backoffDelayMs,
	classifyFailure,
	isAutoRetryable,
	MAX_ATTEMPTS,
	RETRY_MAX_MS,
	shouldGiveUp,
	statusFromError,
} from "./retry";

describe("statusFromError", () => {
	it("reads a numeric status field", () => {
		expect(statusFromError({ status: 403 })).toBe(403);
		expect(statusFromError({ statusCode: 500 })).toBe(500);
	});
	it("extracts an embedded status from a message", () => {
		expect(statusFromError(new Error("Request failed with status 409"))).toBe(
			409,
		);
	});
	it("returns undefined for network errors", () => {
		expect(statusFromError(new TypeError("Failed to fetch"))).toBeUndefined();
	});
});

describe("classifyFailure", () => {
	it("maps HTTP statuses", () => {
		expect(classifyFailure({ status: 401 })).toBe("auth");
		expect(classifyFailure({ status: 409 })).toBe("conflict");
		expect(classifyFailure({ status: 403 })).toBe("terminal");
		expect(classifyFailure({ status: 503 })).toBe("transient");
	});
	it("maps message heuristics when no status is present", () => {
		expect(classifyFailure(new Error("Session expired"))).toBe("auth");
		expect(classifyFailure(new Error("project already registered"))).toBe(
			"conflict",
		);
		expect(
			classifyFailure(new Error("Write access to this workspace is required")),
		).toBe("terminal");
	});
	it("defaults unknown / network failures to transient", () => {
		expect(classifyFailure(new TypeError("Failed to fetch"))).toBe("transient");
		expect(classifyFailure(new Error("something weird"))).toBe("transient");
		expect(classifyFailure(undefined)).toBe("transient");
	});
	it("only transient auto-retries", () => {
		expect(isAutoRetryable("transient")).toBe(true);
		expect(isAutoRetryable("auth")).toBe(false);
		expect(isAutoRetryable("conflict")).toBe(false);
		expect(isAutoRetryable("terminal")).toBe(false);
	});
});

describe("backoffDelayMs", () => {
	it("grows monotonically (at fixed jitter) and caps at RETRY_MAX_MS", () => {
		const fixed = () => 1; // jitter → upper bound of each window
		let prev = 0;
		for (let a = 0; a < 12; a++) {
			const d = backoffDelayMs(a, fixed);
			expect(d).toBeLessThanOrEqual(RETRY_MAX_MS);
			if (a < 6) expect(d).toBeGreaterThanOrEqual(prev);
			prev = d;
		}
	});

	it("never exceeds the cap and stays positive for any rng/attempt", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 40 }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				(attempts, r) => {
					const d = backoffDelayMs(attempts, () => r);
					return d > 0 && d <= RETRY_MAX_MS;
				},
			),
		);
	});

	it("gives up after MAX_ATTEMPTS", () => {
		expect(shouldGiveUp(MAX_ATTEMPTS - 1)).toBe(false);
		expect(shouldGiveUp(MAX_ATTEMPTS)).toBe(true);
		expect(shouldGiveUp(MAX_ATTEMPTS + 3)).toBe(true);
	});
});

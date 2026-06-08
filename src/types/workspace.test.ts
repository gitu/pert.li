import { describe, expect, it } from "vitest";
import { isProjectNotFoundError, PROJECT_NOT_FOUND_MESSAGE } from "./workspace";

// isProjectNotFoundError gates a destructive restore/delete prompt, so it must
// fire ONLY for the explicit "row is gone" signal — never for transport errors
// (which would falsely accuse an offline project of being deleted).
describe("isProjectNotFoundError", () => {
	it("matches the server's not-found error", () => {
		expect(isProjectNotFoundError(new Error(PROJECT_NOT_FOUND_MESSAGE))).toBe(
			true,
		);
	});

	it("is case-insensitive and tolerates surrounding text", () => {
		expect(isProjectNotFoundError(new Error("Error: project not found"))).toBe(
			true,
		);
	});

	it("does NOT match network/transport failures", () => {
		expect(isProjectNotFoundError(new Error("Failed to fetch"))).toBe(false);
		expect(isProjectNotFoundError(new Error("NetworkError"))).toBe(false);
		expect(isProjectNotFoundError(new Error("Load failed"))).toBe(false);
	});

	it("does not match non-Error values", () => {
		expect(isProjectNotFoundError("Project not found")).toBe(false);
		expect(isProjectNotFoundError(null)).toBe(false);
		expect(isProjectNotFoundError(undefined)).toBe(false);
		expect(isProjectNotFoundError({ message: "Project not found" })).toBe(
			false,
		);
	});
});

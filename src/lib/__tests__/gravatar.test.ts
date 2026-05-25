import { describe, expect, it } from "vitest";
import { getGravatarUrl } from "../gravatar";

describe("getGravatarUrl", () => {
	it("hashes a known email to the documented Gravatar SHA-256", async () => {
		// Reference vector from the Gravatar docs: the lowercased, trimmed email
		// "MyEmailAddress@example.com" hashes to this SHA-256 digest.
		// https://docs.gravatar.com/api/avatars/hash/
		const url = await getGravatarUrl(" MyEmailAddress@example.com ");
		expect(url).toContain(
			"84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee",
		);
	});

	it("normalizes case and surrounding whitespace identically", async () => {
		const a = await getGravatarUrl("Foo@Bar.com");
		const b = await getGravatarUrl("  foo@bar.com  ");
		expect(a).toBe(b);
	});

	it("uses d=404 so the consumer can render its own fallback", async () => {
		const url = await getGravatarUrl("anyone@example.com");
		expect(url).toMatch(/[?&]d=404\b/);
	});

	it("honors a custom size", async () => {
		const url = await getGravatarUrl("anyone@example.com", 128);
		expect(url).toMatch(/[?&]s=128\b/);
	});
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildIssueUrl } from "#/lib/pert/issue-tracker";

const JIRA = "https://acme.atlassian.net/browse/{key}";

describe("buildIssueUrl", () => {
	it("substitutes {key} in the template", () => {
		expect(buildIssueUrl(JIRA, "PROJ-123")).toBe(
			"https://acme.atlassian.net/browse/PROJ-123",
		);
	});

	it("substitutes every {key} occurrence", () => {
		expect(buildIssueUrl("https://x/{key}/{key}", "AB-1")).toBe(
			"https://x/AB-1/AB-1",
		);
	});

	it("URL-encodes the key", () => {
		expect(buildIssueUrl("https://x/{key}", "A B/C")).toBe(
			"https://x/A%20B%2FC",
		);
	});

	it("returns the key directly when it is already an http(s) URL", () => {
		expect(buildIssueUrl(JIRA, "https://other/ticket/9")).toBe(
			"https://other/ticket/9",
		);
		// Case-insensitive scheme, and the template is ignored.
		expect(buildIssueUrl(undefined, "HTTP://x/1")).toBe("HTTP://x/1");
	});

	it("returns null for an empty or whitespace key", () => {
		expect(buildIssueUrl(JIRA, "")).toBeNull();
		expect(buildIssueUrl(JIRA, "   ")).toBeNull();
	});

	it("returns null when there is no template and the key is not a URL", () => {
		expect(buildIssueUrl(undefined, "PROJ-1")).toBeNull();
		expect(buildIssueUrl("", "PROJ-1")).toBeNull();
	});

	it("returns null when the template lacks a {key} placeholder", () => {
		expect(
			buildIssueUrl("https://acme.atlassian.net/browse/", "PROJ-1"),
		).toBeNull();
	});

	it("trims the key before substituting", () => {
		expect(buildIssueUrl(JIRA, "  PROJ-7  ")).toBe(
			"https://acme.atlassian.net/browse/PROJ-7",
		);
	});

	// ── Property tests (CLAUDE.md rule 7) ──────────────────────────────────

	it("never throws on arbitrary inputs", () => {
		fc.assert(
			fc.property(
				fc.option(fc.string(), { nil: undefined }),
				fc.string(),
				(template, key) => {
					expect(() => buildIssueUrl(template, key)).not.toThrow();
				},
			),
		);
	});

	it("a non-URL, non-empty key against a {key} template embeds the encoded key", () => {
		const keyArb = fc
			.string({ minLength: 1 })
			.filter((s) => s.trim() !== "" && !/^https?:\/\//i.test(s.trim()));
		fc.assert(
			fc.property(keyArb, (key) => {
				const url = buildIssueUrl("https://t/{key}", key);
				expect(url).not.toBeNull();
				expect(url?.startsWith("https://t/")).toBe(true);
				expect(url).toContain(encodeURIComponent(key.trim()));
			}),
		);
	});

	it("a key that is an http(s) URL is always returned verbatim (trimmed)", () => {
		const urlArb = fc.webUrl().filter((u) => /^https?:\/\//i.test(u));
		fc.assert(
			fc.property(
				fc.option(fc.string(), { nil: undefined }),
				urlArb,
				(template, url) => {
					expect(buildIssueUrl(template, url)).toBe(url);
				},
			),
		);
	});
});

// Console-clean fixture. Specs that import `test` from here (instead of
// `@playwright/test`) automatically fail when the page emits browser console
// errors, warnings, or uncaught page errors during the test. This enforces
// the "browser console must be clean after each interaction" rule from
// CLAUDE.md.
//
// Opt-out by setting `allowedConsoleMessages` via `test.use({...})` when a
// specific warning is genuinely benign (e.g. a third-party script we can't
// silence). Each entry is matched against the raw message text with
// `RegExp.test`.

import { test as base, type Page } from "@playwright/test";

type CapturedMessage = {
	level: "error" | "warning" | "pageerror";
	text: string;
	location?: string;
};

type ConsoleFixtures = {
	allowedConsoleMessages: RegExp[];
	cleanConsole: undefined;
};

// Globally benign console messages. The Gravatar entry is intentional: our
// avatar component requests `?d=404` so the server replies 404 for users
// without a registered avatar, letting the UI fall back to initials. Every
// authed test sees this for the test user — it is not a regression.
const DEFAULT_ALLOWED: RegExp[] = [/gravatar\.com\/avatar\/.*d=404/];

export const test = base.extend<ConsoleFixtures>({
	allowedConsoleMessages: [DEFAULT_ALLOWED, { option: true }],

	cleanConsole: [
		async ({ page, allowedConsoleMessages }, use, testInfo) => {
			const captured: CapturedMessage[] = [];
			attachConsoleListeners(page, captured, allowedConsoleMessages);
			await use();
			if (captured.length === 0) return;
			const summary = captured
				.map(
					(m) =>
						`  [${m.level}] ${m.text}${m.location ? ` (${m.location})` : ""}`,
				)
				.join("\n");
			throw new Error(
				`${captured.length} unexpected console message(s) during "${testInfo.title}":\n${summary}`,
			);
		},
		{ auto: true },
	],
});

export { expect } from "@playwright/test";

function attachConsoleListeners(
	page: Page,
	captured: CapturedMessage[],
	allowed: RegExp[],
) {
	// Match against the message and its location, joined. For resource-load
	// errors (e.g. 404 on an image) Chrome puts the URL in `location()` and
	// leaves the message generic ("Failed to load resource…"). Checking
	// location too lets the allowlist target the offending URL.
	const isAllowed = (text: string, location?: string) => {
		const haystack = location ? `${text} ${location}` : text;
		return allowed.some((re) => re.test(haystack));
	};

	page.on("console", (msg) => {
		const type = msg.type();
		if (type !== "error" && type !== "warning") return;
		const text = msg.text();
		const loc = msg.location();
		const locStr = loc?.url ? `${loc.url}:${loc.lineNumber}` : undefined;
		if (isAllowed(text, locStr)) return;
		captured.push({ level: type, text, location: locStr });
	});

	page.on("pageerror", (err) => {
		const text = err.message;
		if (isAllowed(text)) return;
		captured.push({ level: "pageerror", text });
	});
}

// Pure helpers for resolving a task's external issue reference into a clickable
// URL. Dependency-free and total (never throws) — exercised by property tests.

const HTTP_URL = /^https?:\/\//i;
const KEY_PLACEHOLDER = /\{key\}/g;

// Resolve a single issue key into a link, given the project's URL template.
//
// Resolution rules (in order):
//   1. Empty/whitespace key            → null   (nothing to link)
//   2. Key is itself an http(s) URL    → the key (link directly, ignore template)
//   3. Template contains `{key}`       → template with every `{key}` replaced by
//                                         the URL-encoded key
//   4. Otherwise (no/invalid template) → null   (caller renders the key as text)
//
// A template without a `{key}` placeholder is treated as invalid (→ null) rather
// than guessing where the key should go — predictable over clever.
export function buildIssueUrl(
	template: string | undefined,
	key: string,
): string | null {
	const trimmed = key.trim();
	if (trimmed === "") return null;
	if (HTTP_URL.test(trimmed)) return trimmed;
	if (!template || !template.includes("{key}")) return null;
	return template.replace(KEY_PLACEHOLDER, encodeURIComponent(trimmed));
}

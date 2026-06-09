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
//                                         the URL-encoded key, IF the result is an
//                                         http(s) URL (else null)
//   4. Otherwise (no/invalid template) → null   (caller renders the key as text)
//
// Only http(s) URLs are ever produced. The tracker template lives in the shared
// (collaborative) doc, so without this scheme allowlist a malicious template
// like `javascript:…{key}` would turn every issue link into a script-execution
// sink (CWE-79). A template without a `{key}` placeholder is treated as invalid
// (→ null) rather than guessing where the key should go — predictable over clever.
export function buildIssueUrl(
	template: string | undefined,
	key: string,
): string | null {
	const trimmedKey = key.trim();
	if (trimmedKey === "") return null;
	// A key that is itself an http(s) URL links directly — scheme already safe.
	if (HTTP_URL.test(trimmedKey)) return trimmedKey;
	const trimmedTemplate = template?.trim();
	if (!trimmedTemplate || !trimmedTemplate.includes("{key}")) return null;
	const url = trimmedTemplate.replace(
		KEY_PLACEHOLDER,
		encodeURIComponent(trimmedKey),
	);
	// Reject anything that isn't a plain http(s) URL (javascript:, data:,
	// vbscript:, protocol-relative //host, relative paths, …).
	return HTTP_URL.test(url) ? url : null;
}

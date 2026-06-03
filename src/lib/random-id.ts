// Crypto-strong random id with a fallback for environments where
// crypto.randomUUID is unavailable — older browsers, and notably non-secure
// contexts (self-hosting over plain HTTP on a LAN IP), where calling
// crypto.randomUUID throws. Mirrors the guard already used in chat-history's
// newThreadId so offline project creation can't hard-fail on it.
export function randomId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

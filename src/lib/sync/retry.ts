// Pure helpers for classifying sync/registration failures and computing
// retry backoff. Kept dependency-free so they can be exercised directly with
// Vitest + fast-check — the reconcile loop (reconcile-pending.ts) and the
// status UI both lean on these.

// How a failed `registerProject` (or doc sync) attempt should be treated:
//  - transient: a blip we should retry automatically (offline, 5xx, timeout).
//  - auth:      the session is gone/expired (401). Don't burn attempts — pause
//               the drain until a fresh session appears, then resume.
//  - conflict:  the project (by localId or doc URL) is already registered.
//               Not an error: reconcile to the existing server record.
//  - terminal:  the request can never succeed as-is (403 no write access).
//               Stop auto-retry; surface to the user for manual discard.
export type SyncFailureKind = "transient" | "auth" | "conflict" | "terminal";

const STATUS_RE = /\b(\d{3})\b/;

// Best-effort extraction of an HTTP status from a server-fn error. TanStack
// Start surfaces handler errors as plain Errors whose message often embeds the
// status; network failures throw a TypeError with no status at all.
export function statusFromError(error: unknown): number | undefined {
	if (typeof error === "object" && error !== null) {
		const withStatus = error as { status?: unknown; statusCode?: unknown };
		const raw = withStatus.status ?? withStatus.statusCode;
		if (typeof raw === "number" && raw >= 100 && raw < 600) return raw;
	}
	const message = errorMessage(error);
	const match = message.match(STATUS_RE);
	if (match) {
		const code = Number(match[1]);
		if (code >= 100 && code < 600) return code;
	}
	return undefined;
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return String(error);
	} catch {
		return "Unknown error";
	}
}

export function classifyFailure(error: unknown): SyncFailureKind {
	const status = statusFromError(error);
	if (status === 401) return "auth";
	if (status === 409) return "conflict";
	if (status === 403) return "terminal";
	if (status !== undefined && status >= 500) return "transient";

	const message = errorMessage(error).toLowerCase();
	if (/unauthor|not signed in|no session|session expired/.test(message)) {
		return "auth";
	}
	if (/already (registered|exists)|duplicate|conflict/.test(message)) {
		return "conflict";
	}
	if (/write access|forbidden|not a member|permission/.test(message)) {
		return "terminal";
	}
	// Network-level failures ("Failed to fetch", "NetworkError", timeouts) and
	// anything unrecognised default to transient so a real but unmodelled blip
	// still gets retried — the attempt cap (see shouldGiveUp) prevents a poison
	// record from looping forever.
	return "transient";
}

// A failure kind auto-retries only when transient. `auth` pauses (handled by
// the drain re-arming on a fresh session), `conflict` reconciles, `terminal`
// goes straight to the manual-only error state.
export function isAutoRetryable(kind: SyncFailureKind): boolean {
	return kind === "transient";
}

export const RETRY_BASE_MS = 1_000;
export const RETRY_MAX_MS = 60_000;
export const MAX_ATTEMPTS = 8;

// Capped exponential backoff with full jitter, computed as
// `RETRY_BASE_MS * 2**attempts` (clamped to RETRY_MAX_MS) with jitter applied.
// `attempts` is the running failure count the caller has already recorded —
// the reconcile loop passes `record.attempts` AFTER incrementing it, so the
// first transient failure schedules with attempts=1 → a ~2s window (not 1s).
// rng is injectable so tests can pin the jitter; production passes Math.random.
export function backoffDelayMs(
	attempts: number,
	rng: () => number = Math.random,
): number {
	const exp = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
	// Full jitter: random in [exp/2, exp] keeps a floor so we don't hot-loop
	// while still spreading concurrent records out.
	const floor = exp / 2;
	return Math.round(floor + rng() * (exp - floor));
}

export function shouldGiveUp(attempts: number): boolean {
	return attempts >= MAX_ATTEMPTS;
}

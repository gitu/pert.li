// Tracks whether a visitor has seen the marketing landing page. Used so that
// signed-out returning users land on /signin directly instead of being walked
// through the pitch again on every visit. Storing in localStorage is fine —
// this is a UX hint, not an auth boundary.

export const WELCOME_SEEN_KEY = "pertli.welcomeSeen";

export function hasSeenWelcome(): boolean {
	if (typeof window === "undefined") return false;
	return window.localStorage.getItem(WELCOME_SEEN_KEY) === "1";
}

export function markWelcomeSeen() {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
}

// Registers the PWA service worker emitted by scripts/generate-sw.mjs (run as
// the `build:pwa` post-build step). Native registration — no vite-plugin-pwa
// virtual module — so nothing extra is pulled through the Rolldown client
// bundle. Surfaces an "update available" toast when a new SW takes over.
//
// Gated on VITE_PWA_ENABLED so a plain `pnpm build` (no SW emitted) never
// tries to register a missing /sw.js and pollute the console with a 404.

import { toast } from "sonner";

let registered = false;

export async function registerServiceWorker(): Promise<void> {
	if (registered) return;
	if (import.meta.env.VITE_PWA_ENABLED !== "1") return;
	if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
	registered = true;
	try {
		const registration = await navigator.serviceWorker.register("/sw.js", {
			scope: "/",
		});
		registration.addEventListener("updatefound", () => {
			const installing = registration.installing;
			if (!installing) return;
			installing.addEventListener("statechange", () => {
				// A new SW reached "installed" while an old one still controls the
				// page → an update is ready. Offer a reload to pick up new assets.
				if (
					installing.state === "installed" &&
					navigator.serviceWorker.controller
				) {
					toast("A new version is available.", {
						action: {
							label: "Reload",
							onClick: () => window.location.reload(),
						},
						duration: Number.POSITIVE_INFINITY,
					});
				}
			});
		});
	} catch {
		// Unsupported, blocked, or /sw.js not present — non-fatal.
	}
}

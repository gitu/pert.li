import { useSyncExternalStore } from "react";

// Tracks navigator.onLine, re-rendering on the browser's online/offline events.
// SSR-safe: the server snapshot is always `true` (we never gate SSR on it).

function subscribe(callback: () => void): () => void {
	if (typeof window === "undefined") return () => {};
	window.addEventListener("online", callback);
	window.addEventListener("offline", callback);
	return () => {
		window.removeEventListener("online", callback);
		window.removeEventListener("offline", callback);
	};
}

export function useOnlineStatus(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => (typeof navigator === "undefined" ? true : navigator.onLine),
		() => true,
	);
}

import { useEffect, useState } from "react";

// SSR-safe media-query hook. Initial state is always `false` so the server
// and the first client render agree — anything that would flicker between
// the two is held back to the post-mount render. We default to the
// desktop assumption (mobile = false) because editors are the heavier
// users of pert.li and a one-frame flash of desktop chrome on a phone is
// less jarring than a flash of mobile chrome on a wide screen.
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(false);
	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia(query);
		setMatches(mql.matches);
		const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, [query]);
	return matches;
}

// Canonical breakpoint for the mobile shell. Mirrors Tailwind's `md`
// breakpoint (768px) — anything below is "phone-sized" enough that the
// resizable desktop panels no longer fit.
export function useIsMobile(): boolean {
	return useMediaQuery("(max-width: 767.98px)");
}

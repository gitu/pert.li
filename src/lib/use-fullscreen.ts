import { useCallback, useEffect, useState } from "react";

// Fullscreen toggle via the browser Fullscreen API, with a class-based
// fallback for environments (Storybook in some iframes, Safari quirks)
// where requestFullscreen is unavailable or rejected.
//
// The fallback toggles `.pertli-fullscreen-fallback` on the target element —
// styles in src/styles.css promote that to position:fixed inset:0.
export function useFullscreen(ref: React.RefObject<HTMLElement | null>): {
	active: boolean;
	toggle: () => void;
} {
	const [active, setActive] = useState(false);

	useEffect(() => {
		const onChange = () => {
			setActive(Boolean(document.fullscreenElement));
		};
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);

	const toggle = useCallback(() => {
		const node = ref.current;
		if (!node) return;
		const fsEl = document.fullscreenElement;
		if (fsEl) {
			void document.exitFullscreen();
			return;
		}
		const request = node.requestFullscreen?.bind(node);
		if (request) {
			request().catch(() => {
				node.classList.toggle("pertli-fullscreen-fallback");
				setActive(node.classList.contains("pertli-fullscreen-fallback"));
			});
		} else {
			node.classList.toggle("pertli-fullscreen-fallback");
			setActive(node.classList.contains("pertli-fullscreen-fallback"));
		}
	}, [ref]);

	return { active, toggle };
}

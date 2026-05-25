// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	useViewMode,
	VIEW_MODE_SESSION_KEY,
	ViewModeProvider,
} from "../view-mode";

function setViewport(width: number) {
	// jsdom doesn't actually re-evaluate matchMedia listeners when the
	// viewport changes, but our hook subscribes via `matchMedia(query).matches`
	// at mount time — so we can pretend the viewport is whatever we want by
	// stubbing the result of matchMedia BEFORE rendering. For tests that
	// don't care, the default (1024) is fine.
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		writable: true,
		value: width,
	});
	const originalMatchMedia = window.matchMedia;
	window.matchMedia = (query: string) => {
		const matches = matchesQuery(query, width);
		const listeners = new Set<(e: MediaQueryListEvent) => void>();
		return {
			matches,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: (_evt: string, l: (e: MediaQueryListEvent) => void) => {
				listeners.add(l);
			},
			removeEventListener: (
				_evt: string,
				l: (e: MediaQueryListEvent) => void,
			) => {
				listeners.delete(l);
			},
			dispatchEvent: () => true,
		} as unknown as MediaQueryList;
	};
	return () => {
		window.matchMedia = originalMatchMedia;
	};
}

function matchesQuery(query: string, width: number): boolean {
	const m = query.match(/max-width:\s*([\d.]+)px/);
	if (!m) return false;
	return width <= Number(m[1]);
}

function Probe() {
	const { mode } = useViewMode();
	return <div data-testid="mode">{mode}</div>;
}

function ToggleProbe() {
	const { mode, setEditing } = useViewMode();
	return (
		<div>
			<div data-testid="mode">{mode}</div>
			<button
				type="button"
				onClick={() => setEditing(mode !== "mobile-editing")}
			>
				toggle
			</button>
		</div>
	);
}

describe("ViewModeProvider", () => {
	beforeEach(() => {
		window.sessionStorage.removeItem(VIEW_MODE_SESSION_KEY);
	});
	afterEach(() => {
		cleanup();
		window.sessionStorage.removeItem(VIEW_MODE_SESSION_KEY);
	});

	test("desktop viewport defaults to `desktop`", () => {
		const restore = setViewport(1280);
		try {
			render(
				<ViewModeProvider>
					<Probe />
				</ViewModeProvider>,
			);
			expect(screen.getByTestId("mode").textContent).toBe("desktop");
		} finally {
			restore();
		}
	});

	test("phone viewport defaults to `mobile-readonly`", () => {
		const restore = setViewport(390);
		try {
			render(
				<ViewModeProvider>
					<Probe />
				</ViewModeProvider>,
			);
			expect(screen.getByTestId("mode").textContent).toBe("mobile-readonly");
		} finally {
			restore();
		}
	});

	test("setEditing(true) flips to `mobile-editing` and persists to sessionStorage", () => {
		const restore = setViewport(390);
		try {
			render(
				<ViewModeProvider>
					<ToggleProbe />
				</ViewModeProvider>,
			);
			expect(screen.getByTestId("mode").textContent).toBe("mobile-readonly");
			act(() => {
				screen.getByText("toggle").click();
			});
			expect(screen.getByTestId("mode").textContent).toBe("mobile-editing");
			expect(window.sessionStorage.getItem(VIEW_MODE_SESSION_KEY)).toBe("1");
			// Toggle off clears the flag.
			act(() => {
				screen.getByText("toggle").click();
			});
			expect(screen.getByTestId("mode").textContent).toBe("mobile-readonly");
			expect(window.sessionStorage.getItem(VIEW_MODE_SESSION_KEY)).toBeNull();
		} finally {
			restore();
		}
	});

	test("hydrates from sessionStorage on mount", () => {
		window.sessionStorage.setItem(VIEW_MODE_SESSION_KEY, "1");
		const restore = setViewport(390);
		try {
			render(
				<ViewModeProvider>
					<Probe />
				</ViewModeProvider>,
			);
			expect(screen.getByTestId("mode").textContent).toBe("mobile-editing");
		} finally {
			restore();
		}
	});

	test("setEditing has no visible effect on desktop", () => {
		const restore = setViewport(1280);
		try {
			render(
				<ViewModeProvider>
					<ToggleProbe />
				</ViewModeProvider>,
			);
			expect(screen.getByTestId("mode").textContent).toBe("desktop");
			act(() => {
				screen.getByText("toggle").click();
			});
			// Mode is derived from viewport when not mobile.
			expect(screen.getByTestId("mode").textContent).toBe("desktop");
		} finally {
			restore();
		}
	});
});

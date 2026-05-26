import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect } from "react";

// Three-state colour scheme — "system" lets the OS pick, "light"/"dark" pin.
// Persisted in localStorage under THEME_KEY; an inline preload script in
// __root.tsx applies the resolved class to <html> before React hydrates so
// we never flash the wrong palette.

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "pertli.theme";

type ThemeState = {
	mode: ThemeMode;
	resolved: ResolvedTheme;
};

function readSystem(): ResolvedTheme {
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function readStoredMode(): ThemeMode {
	if (typeof window === "undefined") return "system";
	const raw = window.localStorage.getItem(THEME_KEY);
	if (raw === "light" || raw === "dark" || raw === "system") return raw;
	return "system";
}

function resolve(mode: ThemeMode): ResolvedTheme {
	return mode === "system" ? readSystem() : mode;
}

const initialMode = readStoredMode();

export const themeStore = new Store<ThemeState>({
	mode: initialMode,
	resolved: resolve(initialMode),
});

function applyClass(resolved: ResolvedTheme) {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	if (resolved === "dark") root.classList.add("dark");
	else root.classList.remove("dark");
	root.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode) {
	const resolved = resolve(mode);
	themeStore.setState((s) =>
		s.mode === mode && s.resolved === resolved ? s : { mode, resolved },
	);
	applyClass(resolved);
	if (typeof window !== "undefined") {
		if (mode === "system") window.localStorage.removeItem(THEME_KEY);
		else window.localStorage.setItem(THEME_KEY, mode);
	}
}

// Sets up the system-preference media listener while the provider is mounted.
// Re-evaluates the resolved theme on every OS change when mode === "system".
export function ThemeProvider({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		// Reconcile on mount in case SSR resolved differently than the client OS.
		const stored = readStoredMode();
		const resolved = resolve(stored);
		themeStore.setState(() => ({ mode: stored, resolved }));
		applyClass(resolved);

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => {
			if (themeStore.state.mode !== "system") return;
			const next: ResolvedTheme = media.matches ? "dark" : "light";
			themeStore.setState((s) =>
				s.resolved === next ? s : { ...s, resolved: next },
			);
			applyClass(next);
		};
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	return <>{children}</>;
}

export function useThemeMode(): ThemeMode {
	return useStore(themeStore, (s) => s.mode);
}

export function useResolvedTheme(): ResolvedTheme {
	return useStore(themeStore, (s) => s.resolved);
}

// Inline script body. Runs synchronously in <head> before paint and applies
// the dark class so the first frame already uses the right palette. Kept
// minimal — must be stringified and inlined verbatim, no module syntax.
export const THEME_PRELOAD_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    var mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    var root = document.documentElement;
    if (resolved === 'dark') root.classList.add('dark');
    root.style.colorScheme = resolved;
  } catch (e) {}
})();
`;

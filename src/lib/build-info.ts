// Build metadata baked in at build time and surfaced on the About page.
// `VITE_APP_VERSION` comes from `git describe` (so it already embeds the short
// commit, e.g. `v0.3.2-4-gabc1234`); `VITE_BUILD_TIME` is an ISO timestamp set
// when the build (or dev server) starts. Both are wired up in vite.config.ts.

export const BUILD_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.0-dev";

export const BUILD_TIME: string | null =
	import.meta.env.VITE_BUILD_TIME ?? null;

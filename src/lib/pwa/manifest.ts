import type { AppConfig } from "#/lib/app-config";

// Web app manifest, built from the runtime white-label config so a rebranded
// deployment (APP_NAME / APP_TITLE — see src/lib/app-config.ts) installs to the
// home screen / dock under the operator's chosen name rather than "pert.li".
//
// Pure + isomorphic so it's trivially unit-testable; the server route at
// src/routes/api/manifest.ts wraps it with resolveAppConfig(process.env). Icon
// `src` is an absolute path so it resolves against the origin regardless of the
// manifest URL (served from /api/manifest, not /manifest.json).
export function buildManifest(config: AppConfig): Record<string, unknown> {
	return {
		short_name: config.appName,
		name: config.appTitle,
		icons: [
			{
				src: "/favicon.svg",
				sizes: "any",
				type: "image/svg+xml",
				purpose: "any maskable",
			},
		],
		start_url: "/",
		display: "standalone",
		theme_color: "#18181b",
		background_color: "#fafafa",
	};
}

import { createFileRoute } from "@tanstack/react-router";
import { resolveAppConfig } from "#/lib/app-config";
import { buildManifest } from "#/lib/pwa/manifest";

// Dynamic web app manifest. Served per request so the PWA install name tracks
// the runtime white-label config (APP_NAME / APP_TITLE) without a rebuild — see
// src/lib/pwa/manifest.ts. Matches /api/* so the service worker treats it as
// NetworkOnly (never cached; the browser fetches it fresh at install time).
// `cache-control: no-store` keeps any HTTP cache / CDN from serving a stale
// brand after a rebrand-and-redeploy.
export const Route = createFileRoute("/api/manifest")({
	server: {
		handlers: {
			GET: () =>
				new Response(
					JSON.stringify(buildManifest(resolveAppConfig(process.env))),
					{
						headers: {
							"content-type": "application/manifest+json; charset=utf-8",
							"cache-control": "no-store",
						},
					},
				),
		},
	},
});

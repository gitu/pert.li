import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useLoaderData,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect } from "react";
import { CookieHint } from "../components/legal/cookie-hint";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { AppConfigContext, DEFAULT_APP_CONFIG } from "../lib/app-config";
import { registerServiceWorker } from "../lib/pwa/register-sw";
import { THEME_PRELOAD_SCRIPT, ThemeProvider } from "../lib/theme";
import { getAppConfig } from "../server/config";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	// Runtime white-label config (brand title/name + privacy mode). Resolved on
	// the server per request so deployments configure it via env without a
	// rebuild; `head` reads it from loaderData below so the SSR <title> is right.
	loader: () => getAppConfig(),
	head: ({ loaderData }) => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: loaderData?.appTitle ?? DEFAULT_APP_CONFIG.appTitle,
			},
			{
				name: "description",
				content:
					"Plan something nested. Real-time collaborative PERT charts with three-point estimates, deterministic CPM, and an AI planning assistant.",
			},
			{
				name: "theme-color",
				content: "#18181b",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
			{
				rel: "manifest",
				href: "/api/manifest",
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	// Register the PWA service worker after hydration (client-only). No-ops when
	// the plugin is disabled (dev / e2e).
	useEffect(() => {
		void registerServiceWorker();
	}, []);
	// Root loader data flows the resolved white-label config to every descendant
	// (incl. the shell-rendered CookieHint) via context.
	const config = useLoaderData({ from: "__root__" }) ?? DEFAULT_APP_CONFIG;
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline preload script runs before hydration to avoid a light-mode flash. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_PRELOAD_SCRIPT }} />
			</head>
			<body>
				<AppConfigContext.Provider value={config}>
					<ThemeProvider>
						{/* RepoProvider is mounted by `_app.tsx` so unauthenticated routes
						    (welcome, signin, privacy) never open the Automerge WebSocket
						    to /sync — that endpoint rejects without a session and crashed
						    the Nitro proxy when reached from a public page. */}
						{children}
						<CookieHint />
					</ThemeProvider>
				</AppConfigContext.Provider>
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
						TanStackQueryDevtools,
					]}
				/>
				{/* The devtools floating launcher overlaps the mobile bottom
				    nav during e2e on phone viewports. The @tanstack/devtools-vite
				    plugin strips the call entirely in production builds, so a
				    conditional wrapper would confuse it; instead we just hide
				    the launcher with CSS when the harness signals e2e mode.
				    The img alt attribute is what the launcher renders. */}
				{import.meta.env.VITE_E2E === "1" && (
					<style
						// biome-ignore lint/security/noDangerouslySetInnerHtml: short inline rule, no user input.
						dangerouslySetInnerHTML={{
							__html:
								'img[alt="TanStack Devtools"]{display:none!important;pointer-events:none!important;}',
						}}
					/>
				)}
				<Scripts />
			</body>
		</html>
	);
}

import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { CookieHint } from "../components/legal/cookie-hint";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { THEME_PRELOAD_SCRIPT, ThemeProvider } from "../lib/theme";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "pert.li — collaborative PERT planning",
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
				href: "/manifest.json",
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline preload script runs before hydration to avoid a light-mode flash. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_PRELOAD_SCRIPT }} />
			</head>
			<body>
				<ThemeProvider>
					{/* RepoProvider is mounted by `_app.tsx` so unauthenticated routes
					    (welcome, signin, privacy) never open the Automerge WebSocket
					    to /sync — that endpoint rejects without a session and crashed
					    the Nitro proxy when reached from a public page. */}
					{children}
					<CookieHint />
				</ThemeProvider>
				{/* The devtools floating launcher overlaps the mobile bottom
				    nav and intercepts pointer events during e2e on phone
				    viewports. Hide it whenever the harness signals e2e mode. */}
				{import.meta.env.VITE_E2E !== "1" && (
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
				)}
				<Scripts />
			</body>
		</html>
	);
}

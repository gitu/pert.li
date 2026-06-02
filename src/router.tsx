import {
	createRouter as createTanStackRouter,
	Link,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

// App-styled 404 for any path that doesn't match a route (and for
// notFound() errors thrown by loaders without a closer notFoundComponent).
// Without this, TanStack Router renders its bare "<p>Not Found</p>" default
// and logs a warning on every miss.
function DefaultNotFound() {
	return (
		<div className="grid min-h-svh place-items-center bg-background p-6 text-center">
			<div className="max-w-sm space-y-3">
				<h2 className="text-lg font-semibold">Page not found</h2>
				<p className="text-sm text-muted-foreground">
					The page you're looking for doesn't exist or has moved.
				</p>
				<Link
					to="/"
					className="inline-flex h-8 items-center rounded-md border bg-secondary px-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
				>
					Back to workspace
				</Link>
			</div>
		</div>
	);
}

export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		defaultNotFoundComponent: DefaultNotFound,
	});

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}

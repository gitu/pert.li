// Wraps the (client-only) app shell with TanStack Query's persistence provider
// so the workspace/project read caches are restored from IndexedDB on boot and
// flushed back on change. Mounted under the ssr:false `/_app` route, so the
// async IndexedDB persister never runs during server render.

import type { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactNode, useState } from "react";
import { buildPersistOptions } from "./persist-config";

export function QueryPersistGate({
	client,
	children,
}: {
	client: QueryClient;
	children: ReactNode;
}) {
	// Build once — createAsyncStoragePersister captures the idb storage adapter;
	// re-creating it each render would churn the restore subscription.
	const [persistOptions] = useState(() => buildPersistOptions());
	return (
		<PersistQueryClientProvider client={client} persistOptions={persistOptions}>
			{children}
		</PersistQueryClientProvider>
	);
}

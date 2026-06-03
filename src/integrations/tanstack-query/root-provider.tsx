import { QueryClient } from "@tanstack/react-query";
import { QUERY_PERSIST_MAX_AGE } from "#/lib/query/persist-config";

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// Keep cached query data around long enough to be rehydrated from
				// IndexedDB on a later (possibly offline) session. Must be >= the
				// persister maxAge or restored entries get gc'd on contact.
				gcTime: QUERY_PERSIST_MAX_AGE,
				// offlineFirst: run the query fn even when the browser reports
				// offline, but if it throws (no network) fall back to cached data
				// instead of retry-storming. Pairs with the IndexedDB persister so
				// lists render from disk while offline.
				networkMode: "offlineFirst",
			},
		},
	});

	return {
		queryClient,
	};
}
export default function TanstackQueryProvider() {}

// TanStack Query persistence to IndexedDB so the project list (and resolved
// project→docUrl lookups) survive a reload and render offline. Only the
// workspace/project read queries are persisted — never mutations or
// auth-sensitive reads.

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

export const QUERY_PERSIST_KEY = "pert.li:react-query";

// One week — long enough that an offline user keeps a usable list across
// sessions, bounded so a stale cache eventually expires.
export const QUERY_PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

// Query-key prefixes worth persisting for offline. `project` (singular) backs
// useProjectDoc's projectId→docUrl resolution, so caching it lets a
// previously-opened project's canvas load offline.
const PERSISTED_PREFIXES = new Set(["projects", "my-workspaces", "project"]);

const idbStorage = {
	getItem: (key: string) => get<string>(key).then((v) => v ?? null),
	setItem: (key: string, value: string) => set(key, value),
	removeItem: (key: string) => del(key),
};

export function createQueryPersister() {
	return createAsyncStoragePersister({
		storage: idbStorage,
		key: QUERY_PERSIST_KEY,
		throttleTime: 1000,
	});
}

export function buildPersistOptions(): Omit<
	PersistQueryClientOptions,
	"queryClient"
> {
	return {
		persister: createQueryPersister(),
		maxAge: QUERY_PERSIST_MAX_AGE,
		dehydrateOptions: {
			shouldDehydrateQuery: (query) => {
				const prefix = query.queryKey[0];
				if (typeof prefix !== "string" || !PERSISTED_PREFIXES.has(prefix)) {
					return false;
				}
				// Don't persist error states — a failed offline fetch shouldn't
				// overwrite a good cached list on disk.
				return query.state.status === "success";
			},
		},
	};
}

export async function clearQueryPersistence(): Promise<void> {
	try {
		await del(QUERY_PERSIST_KEY);
	} catch {
		// Best-effort.
	}
}

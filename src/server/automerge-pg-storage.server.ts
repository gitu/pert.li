import type {
	Chunk,
	StorageAdapterInterface,
	StorageKey,
} from "@automerge/automerge-repo";
import { eq, like, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { automergeStorage } from "#/db/schema";

// Persistent Automerge storage backed by Postgres (Neon). Replaces the
// NodeFS adapter in deployed environments where the filesystem is
// ephemeral (Cloud Run, Fly machines, etc.).
//
// Key encoding: storage keys are arrays of strings — documentIds (base58),
// chunk types ("snapshot" / "incremental" / "sync-state"), and content
// hashes (base58/hex). None of those contain `/`, so joining with `/` is
// unambiguous. Range queries match `key = $prefix OR key LIKE $prefix || '/%'`
// so the prefix itself is included alongside descendants.

function encodeKey(parts: StorageKey): string {
	return parts.join("/");
}

function decodeKey(joined: string): StorageKey {
	return joined.split("/");
}

export class PostgresStorageAdapter implements StorageAdapterInterface {
	async load(key: StorageKey): Promise<Uint8Array | undefined> {
		const k = encodeKey(key);
		const rows = await db
			.select({ data: automergeStorage.data })
			.from(automergeStorage)
			.where(eq(automergeStorage.key, k))
			.limit(1);
		return rows[0]?.data;
	}

	async save(key: StorageKey, data: Uint8Array): Promise<void> {
		const k = encodeKey(key);
		// Buffer must be copied — Drizzle/Neon retains the reference until the
		// request flushes, and the caller is free to mutate `data` after the
		// promise is created.
		const copy = new Uint8Array(data);
		await db
			.insert(automergeStorage)
			.values({ key: k, data: copy, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: automergeStorage.key,
				set: { data: copy, updatedAt: new Date() },
			});
	}

	async remove(key: StorageKey): Promise<void> {
		const k = encodeKey(key);
		await db.delete(automergeStorage).where(eq(automergeStorage.key, k));
	}

	async loadRange(prefix: StorageKey): Promise<Chunk[]> {
		const p = encodeKey(prefix);
		const rows = await db
			.select({ key: automergeStorage.key, data: automergeStorage.data })
			.from(automergeStorage)
			.where(
				or(eq(automergeStorage.key, p), like(automergeStorage.key, `${p}/%`)),
			);
		return rows.map((r) => ({ key: decodeKey(r.key), data: r.data }));
	}

	async removeRange(prefix: StorageKey): Promise<void> {
		const p = encodeKey(prefix);
		await db
			.delete(automergeStorage)
			.where(
				or(eq(automergeStorage.key, p), like(automergeStorage.key, `${p}/%`)),
			);
	}
}

// Health probe used at startup so we fail loudly if the table is missing.
// Cheaper than waiting for the first user-triggered write to surface the
// "relation does not exist" error.
export async function pingAutomergeStorage(): Promise<void> {
	await db.execute(sql`SELECT 1 FROM ${automergeStorage} LIMIT 1`);
}

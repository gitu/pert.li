import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

let _db: NeonHttpDatabase<typeof schema> | undefined;

export function getDb(): NeonHttpDatabase<typeof schema> {
	if (_db) return _db;
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"DATABASE_URL is not set. In dev, the neon vite plugin should provision it on first start.",
		);
	}
	_db = drizzle(neon(url), { schema });
	return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
	get: (_target, prop, receiver) => Reflect.get(getDb(), prop, receiver),
});

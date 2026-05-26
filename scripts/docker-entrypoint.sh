#!/bin/sh
# pert.li container entrypoint.
#
# Runs schema management before the Nitro server starts so a fresh deployment
# boots into a working state. The migrator is idempotent — re-running it
# against an up-to-date database is a no-op.
#
# Behaviour:
#   SKIP_MIGRATE=1        → skip schema management entirely (handle it
#                           out-of-band, e.g. as a separate k8s Job)
#   BASELINE_MIGRATIONS=1 → mark every journal entry as applied without
#                           running its SQL. Set this on a single boot
#                           when switching an existing database from
#                           `drizzle-kit push` to migrations, then clear it.
#   DATABASE_URL set      → run `node ./scripts/migrate.mjs` against that
#                           database (applies migrations from ./drizzle/)
#   DATABASE_URL unset    → no migration step (the server itself will boot
#                           an in-process PGLite at LOCAL_PGLITE_DIR;
#                           PGLite-in-production is experimental — see
#                           SELF_HOSTING.md)
#
# Errors during migration are fatal — we'd rather refuse to start than
# serve requests against a stale schema.

set -e

if [ "$SKIP_MIGRATE" = "1" ]; then
	echo "[entrypoint] SKIP_MIGRATE=1 — skipping migrations"
elif [ -n "$DATABASE_URL" ]; then
	node ./scripts/migrate.mjs
else
	echo "[entrypoint] No DATABASE_URL — server will boot in-process PGLite (experimental)"
fi

echo "[entrypoint] Starting pert.li on :\${PORT:-8080}"
exec node .output/server/index.mjs

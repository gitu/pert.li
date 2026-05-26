#!/bin/sh
# pert.li container entrypoint.
#
# Runs schema management before the Nitro server starts so a fresh deployment
# boots into a working state. The schema push is idempotent — re-running it
# against an up-to-date database is a no-op.
#
# Behaviour:
#   SKIP_MIGRATE=1   → skip schema management entirely (you'll handle it
#                      out-of-band, e.g. as a separate k8s Job)
#   DATABASE_URL set → run `drizzle-kit push` against that database
#   DATABASE_URL un‑ → no migration step (the server itself will boot an
#       set                in-process PGLite at LOCAL_PGLITE_DIR; PGLite-in-
#                      production is experimental, see SELF_HOSTING.md)
#
# Errors during the push are fatal — we'd rather refuse to start than serve
# requests against a stale schema.

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

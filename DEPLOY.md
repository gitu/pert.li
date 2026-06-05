# Deploying pert.li to Cloud Run

The repo ships with a multi-stage `Dockerfile` and a `cloudbuild.yaml` that
builds the image, pushes it to Artifact Registry, and rolls out to Cloud Run.
The **same** `cloudbuild.yaml` drives two environments via per-trigger
substitutions:

| Environment | Trigger event | `_SERVICE` | Rolls out when |
| --- | --- | --- | --- |
| **Staging** | push to `main` | `pert-li-staging` | always (every push) |
| **Production** | push of a `v*` tag | `pert-li` | only if the tag is reachable from `main` **and** is the newest `v*` version (the `_VERSION_GATE=on` check) |

So `main` continuously deploys staging, and production only advances to a
newer version that shipped through `main`. To release: merge to `main`, then
`git tag vX.Y.Z <main-commit> && git push origin vX.Y.Z`. A tag on a side
branch, or an older / re-pushed tag, still builds the image but **skips** the
production rollout — prod never moves backwards. See the header of
`cloudbuild.yaml` for the full substitution matrix.

## One-time setup

1. **Enable APIs** (run once per GCP project):

   ```bash
   gcloud services enable \
     run.googleapis.com \
     cloudbuild.googleapis.com \
     artifactregistry.googleapis.com \
     secretmanager.googleapis.com
   ```

2. **Create the Artifact Registry repo**:

   ```bash
   gcloud artifacts repositories create pert-li \
     --repository-format=docker \
     --location=europe-west1
   ```

3. **Create the secrets** (Secret Manager). The Cloud Build deploy step
   mounts these as env vars on the Cloud Run service:

   ```bash
   echo -n 'postgres://...neon-prod-url...' | \
     gcloud secrets create DATABASE_URL --data-file=-
   echo -n "$(npx -y @better-auth/cli secret)" | \
     gcloud secrets create BETTER_AUTH_SECRET --data-file=-
   echo -n 'AIza...your-gemini-key...' | \
     gcloud secrets create GEMINI_API_KEY --data-file=-
   echo -n 're_...your-resend-api-key...' | \
     gcloud secrets create RESEND_API_KEY --data-file=-
   ```

   `RESEND_API_KEY` powers passwordless magic-link sign-in via Better Auth.
   The sender address is the `_RESEND_FROM_EMAIL` substitution in
   `cloudbuild.yaml` (default `onboarding@resend.dev`, which Resend allows
   without domain verification but only delivers to the API key owner's
   email — override with `--substitutions=_RESEND_FROM_EMAIL=mail@yourdomain.com`
   on the trigger once you've verified a domain in Resend).

   Add `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` the same way if you want to
   swap providers; then either add them to `--set-secrets` in
   `cloudbuild.yaml` or set `LLM_PROVIDER=<name>` and rely on the
   auto-detect order in `src/lib/ai/provider.ts`.

   **Staging gets its own secrets.** The staging trigger overrides every
   `_*_SECRET` substitution so staging reads/writes a **separate database**
   and never touches prod data. Create the `_STAGING` counterparts (at
   minimum a distinct `DATABASE_URL_STAGING`; reuse the others only if you
   accept the coupling):

   ```bash
   echo -n 'postgres://...neon-STAGING-url...' | \
     gcloud secrets create DATABASE_URL_STAGING --data-file=-
   echo -n "$(npx -y @better-auth/cli secret)" | \
     gcloud secrets create BETTER_AUTH_SECRET_STAGING --data-file=-
   echo -n 'AIza...your-gemini-key...' | \
     gcloud secrets create GEMINI_API_KEY_STAGING --data-file=-
   echo -n 're_...your-resend-api-key...' | \
     gcloud secrets create RESEND_API_KEY_STAGING --data-file=-
   ```

   The staging trigger then points `_DATABASE_URL_SECRET=DATABASE_URL_STAGING`,
   `_BETTER_AUTH_SECRET_NAME=BETTER_AUTH_SECRET_STAGING`, etc. (see step 6).
   ⚠️ If the staging trigger omits these overrides it falls back to the
   production defaults in `cloudbuild.yaml` and **staging will write the prod
   database.**

4. **Grant the Cloud Build service account permission** to deploy to Cloud
   Run and read the secrets:

   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
   CB_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

   for role in run.admin iam.serviceAccountUser secretmanager.secretAccessor; do
     gcloud projects add-iam-policy-binding "$PROJECT_ID" \
       --member="serviceAccount:${CB_SA}" \
       --role="roles/${role}"
   done
   ```

5. **Database schema.** No manual step. The container entrypoint
   (`scripts/docker-entrypoint.sh` → `scripts/migrate.mjs`) applies
   versioned SQL migrations from `./drizzle/` against `DATABASE_URL`
   on every boot and exits if any fail. Schema changes ship as
   committed migration files (`pnpm db:generate` → commit the
   generated `drizzle/NNNN_*.sql`), not via `drizzle-kit push`.

   If you're pointing this deploy at an existing database that was
   previously managed with `drizzle-kit push`, the schema is present
   but `drizzle.__drizzle_migrations` is empty — migrate will crash
   with `42710 ... already exists`. Set `BASELINE_MIGRATIONS=1` on
   the Cloud Run service env vars and deploy once; the entrypoint
   will record every journal entry as applied without re-running its
   SQL. Clear the flag afterwards.

6. **Create the two Cloud Build triggers.** A given trigger targets a given
   environment purely through its `--substitutions` — the build config is
   shared. The two knobs that matter most are `_SERVICE` (which Cloud Run
   service to deploy) and `_DATABASE_URL_SECRET` (which Secret Manager entry
   to mount as `DATABASE_URL`).

   **Staging — push to `main`:**

   ```bash
   gcloud builds triggers create github \
     --name=pert-li-staging \
     --repo-name=pert.li \
     --repo-owner=<your-github-owner> \
     --branch-pattern='^main$' \
     --build-config=cloudbuild.yaml \
     --substitutions=\
   _SERVICE=pert-li-staging,\
   _VERSION_GATE=off,\
   _BETTER_AUTH_URL=https://staging.pert.li/,\
   _DATABASE_URL_SECRET=DATABASE_URL_STAGING,\
   _BETTER_AUTH_SECRET_NAME=BETTER_AUTH_SECRET_STAGING,\
   _GEMINI_API_KEY_SECRET=GEMINI_API_KEY_STAGING,\
   _RESEND_API_KEY_SECRET=RESEND_API_KEY_STAGING
   ```

   **Production — push of a `v*` tag:**

   ```bash
   gcloud builds triggers create github \
     --name=pert-li-prod \
     --repo-name=pert.li \
     --repo-owner=<your-github-owner> \
     --tag-pattern='^v.*$' \
     --build-config=cloudbuild.yaml \
     --substitutions=\
   _SERVICE=pert-li,\
   _VERSION_GATE=on,\
   _BETTER_AUTH_URL=https://pert.li/
   ```

   Production keeps the prod secret defaults from `cloudbuild.yaml`
   (`DATABASE_URL`, `BETTER_AUTH_SECRET`, …) so it only needs to override
   `_SERVICE`, `_VERSION_GATE`, and `_BETTER_AUTH_URL`. `_VERSION_GATE=on`
   is what enforces "from main and newer than the current version" before a
   rollout.

   **Switching service / overriding the database secret on an _existing_
   trigger.** Both knobs are just substitutions, so repoint a trigger
   without recreating it. `triggers update` **replaces** the substitution
   map, so always pass the full set you want:

   ```bash
   # Point the main trigger at staging + a separate DB (the repoint you need
   # if `main` currently deploys prod):
   gcloud builds triggers update pert-li-staging \
     --substitutions=\
   _SERVICE=pert-li-staging,\
   _VERSION_GATE=off,\
   _BETTER_AUTH_URL=https://staging.pert.li/,\
   _DATABASE_URL_SECRET=DATABASE_URL_STAGING,\
   _BETTER_AUTH_SECRET_NAME=BETTER_AUTH_SECRET_STAGING,\
   _GEMINI_API_KEY_SECRET=GEMINI_API_KEY_STAGING,\
   _RESEND_API_KEY_SECRET=RESEND_API_KEY_STAGING
   ```

   `_SERVICE` selects the Cloud Run service the `deploy` step targets;
   `_DATABASE_URL_SECRET` selects the Secret Manager entry bound to
   `DATABASE_URL` (the service reads/writes whatever DB that URL points at).
   Inspect what a trigger is currently set to with:

   ```bash
   gcloud builds triggers describe pert-li-staging \
     --format='value(substitutions)'
   ```

   > ⚠️ **You already have `main` deploying prod.** Until the `main` trigger
   > is repointed to `pert-li-staging` (and a `DATABASE_URL_STAGING` secret),
   > the next push to `main` rolls out to **production**. Run the
   > `triggers update` above before merging more work to `main`.

   The first staging deploy creates the service URL; once you have it, update
   the trigger's `_BETTER_AUTH_URL` to match (and map `staging.pert.li` /
   `pert.li` to the services via Cloud Run domain mappings). Better Auth uses
   `_BETTER_AUTH_URL` for cookie domain and redirect URLs — if it's wrong,
   sign-in silently fails.

## Local smoke test of the production image

```bash
docker build -t pert-li:local .
docker run --rm -p 8080:8080 \
  -e DATABASE_URL='postgres://...prod...' \
  -e BETTER_AUTH_SECRET='...' \
  -e BETTER_AUTH_URL='http://localhost:8080' \
  -e GEMINI_API_KEY='AIza...' \
  pert-li:local
```

Open `http://localhost:8080` and sign in. WebSocket sync should connect
to `ws://localhost:8080/sync`.

## Operational notes

- **Storage**: in production the Automerge sync server uses the
  `PostgresStorageAdapter` (set via `AUTOMERGE_STORAGE=postgres` in the
  Dockerfile). Documents persist across cold starts.
- **Scaling**: `min-instances=0` (scale to zero) saves cost. The first
  request after idle pays a ~2–4s cold start. `--session-affinity`
  pins a client to one instance for an hour so the in-memory Repo on
  that instance stays consistent for them.
- **Multi-instance fan-out is NOT wired**: two users hitting different
  instances will only see each other's edits after one of them reloads
  (durable state is in Postgres; live sync is in-process). Adding a
  Redis pub/sub between instances is the next step if concurrent load
  grows.
- **Releasing to prod**: merge to `main` (auto-deploys staging), verify on
  staging, then tag: `git tag vX.Y.Z <main-commit> && git push origin vX.Y.Z`.
  The prod build runs the version gate (`version-gate` step) — if the tag
  isn't reachable from `main` or isn't the newest `v*` version, the build
  succeeds and pushes the image but logs `deploy skipped — version gate did
  not approve …` and does not roll out. The deployed version is recorded as
  the `APP_VERSION` env var on the service (`gcloud run services describe
  pert-li --region=europe-west1 --format='value(spec.template.spec.containers[0].env)'`).
- **Rollback**: `gcloud run services update-traffic <service> --region=europe-west1 --to-revisions=<prev>=100`
  (`<service>` is `pert-li` for prod, `pert-li-staging` for staging).

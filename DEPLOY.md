# Deploying pert.li to Cloud Run

The repo ships with a multi-stage `Dockerfile` and a `cloudbuild.yaml` that
builds the image, pushes it to Artifact Registry, and rolls out to Cloud
Run on every push to `main`.

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

6. **Create the Cloud Build trigger** pointing at your GitHub repo's
   `main` branch:

   ```bash
   gcloud builds triggers create github \
     --name=pert-li-main \
     --repo-name=pert.li \
     --repo-owner=<your-github-owner> \
     --branch-pattern='^main$' \
     --build-config=cloudbuild.yaml \
     --substitutions=_BETTER_AUTH_URL=https://pert-li-<PROJECT_NUMBER>.europe-west1.run.app
   ```

   The first deploy creates the service URL; once you have it, update the
   trigger's `_BETTER_AUTH_URL` substitution to match. Better Auth uses
   this for cookie domain and redirect URLs — if it's wrong, sign-in
   silently fails.

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
- **Rollback**: `gcloud run services update-traffic pert-li --to-revisions=<prev>=100`.

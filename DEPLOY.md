# Deploying pert.li to Cloud Run

**The image is built once, by GitHub — not by Google Cloud.** The
[`Docker` workflow](.github/workflows/docker.yml) builds the multi-stage
`Dockerfile`, runs the secret-leak gate (synthetic secrets), and pushes the
image to **ghcr.io** on every push to `main` and every `v*` tag. It then hands
off to Google Cloud over Workload Identity Federation: it runs a **deploy-only**
Cloud Build trigger (`cloudbuild.yaml`) pinned to the commit, which pulls *that
same image* through an Artifact Registry **remote-repo proxy** of ghcr.io — no
rebuild on the Google side — re-runs the secret-leak gate against the real
Secret Manager values, applies the promotion gate, and rolls out to Cloud Run.

```
push main / tag ─► GitHub Actions: build + gate (synthetic) + push ghcr.io
                          │
                          └─ gcloud builds triggers run  (WIF auth, --sha=<commit>)
                                      │
                          Cloud Build (deploy-only): pull via AR proxy of ghcr.io
                          ──► gate (real secrets) ──► version-gate ──► gcloud run deploy
```

Cloud Run can't pull from ghcr.io directly, so the remote-repo proxy bridges it
(lazy fetch + cache, keyed by the immutable full-commit-SHA tag GitHub pushes).
The **same** `cloudbuild.yaml` drives two environments via per-trigger
substitutions:

| Environment | GitHub event | `_SERVICE` | Rolls out when |
| --- | --- | --- | --- |
| **Staging** | push to `main` | `pert-li-staging` | always (every push, `_VERSION_GATE=off`) |
| **Production** | push of a `v*` tag | `pert-li` | only if the tag is reachable from `main` **and** is the newest `v*` version (`_VERSION_GATE=on`) |

So `main` continuously deploys staging, and production only advances to a newer
version that shipped through `main`. To release: merge to `main`, then
`git tag vX.Y.Z <main-commit> && git push origin vX.Y.Z`. A tag on a side
branch, or an older / re-pushed tag, still builds + pushes the image but
**skips** the production rollout — prod never moves backwards. See the header
of `cloudbuild.yaml` for the full substitution matrix.

## One-time setup

1. **Enable APIs** (run once per GCP project):

   ```bash
   gcloud services enable \
     run.googleapis.com \
     cloudbuild.googleapis.com \
     artifactregistry.googleapis.com \
     secretmanager.googleapis.com \
     iamcredentials.googleapis.com \
     sts.googleapis.com
   ```

2. **Create the Artifact Registry remote repo** that proxies ghcr.io. Cloud
   Run deploys from here; AR caches what it pulls from ghcr.io on first request.
   (If your ghcr package is public, no upstream credentials are needed.)

   ```bash
   gcloud artifacts repositories create ghcr-remote \
     --repository-format=docker \
     --mode=remote-repository \
     --remote-docker-repo=https://ghcr.io \
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

4. **Create a dedicated deploy service account** with least-privilege roles to
   deploy to Cloud Run, read the secrets, pull the proxied image, and write
   build logs. Cloud Build triggers in this project must run as an **explicit**
   service account (the legacy default Cloud Build SA is disabled), so this SA
   is passed to each trigger via `--service-account` (step 6).

   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

   gcloud iam service-accounts create pert-li-deployer \
     --display-name="pert.li Cloud Build deployer"
   DEPLOYER="pert-li-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

   # run.admin (deploy) · iam.serviceAccountUser (actAs the runtime SA) ·
   # secretmanager.secretAccessor (secrets-check reads real secrets) ·
   # artifactregistry.reader (pull the proxied image) ·
   # logging.logWriter (required for builds that run as a user-specified SA).
   for role in run.admin iam.serviceAccountUser secretmanager.secretAccessor artifactregistry.reader logging.logWriter; do
     gcloud projects add-iam-policy-binding "$PROJECT_ID" \
       --member="serviceAccount:${DEPLOYER}" --role="roles/${role}"
   done

   # The Cloud Run runtime service agent also pulls the image on cold start:
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com" \
     --role="roles/artifactregistry.reader"
   ```

4b. **Set up Workload Identity Federation** so the GitHub workflow can run the
   deploy trigger without a long-lived key. A dedicated `gh-deploy` SA that the
   repo's workflow impersonates, allowed only from `main` + tags:

   ```bash
   gcloud iam service-accounts create gh-deploy --display-name="GitHub Actions deploy"
   DEPLOY_SA="gh-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

   # It only needs to *start* builds; the build runs as CB_SA above.
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:${DEPLOY_SA}" --role="roles/cloudbuild.builds.editor"

   gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
   # The attribute-condition restricts which OIDC tokens can mint a credential:
   # only this repo, and only on the main branch or a tag (not PRs/other branches).
   gcloud iam workload-identity-pools providers create-oidc github \
     --location=global --workload-identity-pool=github --display-name="GitHub OIDC" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
     --attribute-condition="assertion.repository=='<owner>/pert.li' && (assertion.ref=='refs/heads/main' || assertion.ref.startsWith('refs/tags/'))"

   POOL_ID=$(gcloud iam workload-identity-pools describe github --location=global --format='value(name)')
   gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
     --role="roles/iam.workloadIdentityUser" \
     --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/<owner>/pert.li"

   # Provider resource name — the GCP_WORKLOAD_IDENTITY_PROVIDER secret (step 7):
   gcloud iam workload-identity-pools providers describe github \
     --location=global --workload-identity-pool=github --format='value(name)'
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

6. **Create the two deploy-only Cloud Build triggers** — staging + prod. They
   are **manual-invocation** (no branch/tag pattern) so they do *not* fire on
   push; GitHub runs them after the image is on ghcr.io. Both share
   `cloudbuild.yaml` and differ only by substitutions. Each overrides
   `_REMOTE_REPO` / `_GHCR_IMAGE` (the proxied image) and `_VERSION_GATE`.

   The flags depend on how your repo is connected to Cloud Build:

   - **2nd-gen** (Cloud Build *repositories* / host connection — check with
     `gcloud builds connections list --region=<region>`): triggers are
     **regional** and reference the connected repository resource:

     ```bash
     REPO=projects/<project>/locations/<region>/connections/<conn>/repositories/<repo>
     DEPLOYER=projects/<project>/serviceAccounts/pert-li-deployer@<project>.iam.gserviceaccount.com

     # Staging — run by GitHub on push to main. Override only the secrets that
     # actually differ from prod (inspect with `gcloud run services describe`).
     # `--branch=main` is a required default ref for a manual --repository
     # trigger; the workflow's `--sha=<commit>` overrides it at run time.
     # `--service-account` is REQUIRED (the default Cloud Build SA is disabled);
     # without it the create fails with a bare `INVALID_ARGUMENT`.
     gcloud builds triggers create manual \
       --name=pert-li-deploy-staging --region=<region> \
       --repository="$REPO" --branch=main --build-config=cloudbuild.yaml \
       --service-account="$DEPLOYER" \
       --substitutions=_SERVICE=pert-li-staging,_VERSION_GATE=off,_REMOTE_REPO=ghcr-remote,_GHCR_IMAGE=<owner>/pert.li,_BETTER_AUTH_URL=https://staging.pert.li,_RESEND_FROM_EMAIL=noreply@pert.li,_DATABASE_URL_SECRET=DATABASE_URL_STAGING

     # Prod — run by GitHub on a v* tag. cloudbuild.yaml defaults are prod.
     gcloud builds triggers create manual \
       --name=pert-li-deploy-prod --region=<region> \
       --repository="$REPO" --branch=main --build-config=cloudbuild.yaml \
       --service-account="$DEPLOYER" \
       --substitutions=_VERSION_GATE=on,_REMOTE_REPO=ghcr-remote,_GHCR_IMAGE=<owner>/pert.li
     ```

   - **1st-gen** (legacy GitHub App): drop `--region`, keep `--service-account`,
     and replace `--repository=... --branch=main` with:

     ```bash
     --repo=https://github.com/<owner>/pert.li --repo-type=github
     ```

   `_GHCR_IMAGE` is the **lowercase** `owner/repo` ghcr path. Any substitution
   you omit falls back to the `cloudbuild.yaml` default (prod values), so
   staging must override at least `_DATABASE_URL_SECRET` or it will write the
   **prod** database. `_VERSION_GATE=on` (prod) enforces "from main and newest
   version" before rollout; `off` (staging) always deploys.

   If you previously had **auto-firing** build+deploy triggers (e.g. `on-main`
   / `on-version`), **delete them** — they would now run this deploy-only
   config on push, racing the ghcr push and double-deploying alongside
   GitHub's manual invocation:
   `gcloud builds triggers delete <name> --region=<region>`.

7. **Wire the GitHub repo** (Settings → Secrets and variables → Actions), or
   via `gh`:

   ```bash
   gh secret   set GCP_WORKLOAD_IDENTITY_PROVIDER --body "<provider resource name from step 4b>"
   gh secret   set GCP_DEPLOY_SERVICE_ACCOUNT     --body "gh-deploy@<project>.iam.gserviceaccount.com"
   gh variable set CLOUD_BUILD_STAGING_TRIGGER    --body "pert-li-deploy-staging"
   gh variable set CLOUD_BUILD_PROD_TRIGGER       --body "pert-li-deploy-prod"
   gh variable set CLOUD_BUILD_REGION             --body "<region>"   # or "global" for 1st-gen
   ```

   Also confirm the **ghcr package is public** (repo → Packages → package
   settings) so the AR proxy can pull without upstream credentials. The first
   staging deploy creates the service URL; map `staging.pert.li` / `pert.li` to
   the services via Cloud Run domain mappings and keep `_BETTER_AUTH_URL` in
   sync — Better Auth uses it for cookie domain and redirect URLs, and sign-in
   silently fails if it's wrong.

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
- **Releasing to prod**: merge to `main` (GitHub builds, pushes to ghcr.io,
  and triggers the staging deploy), verify on staging, then tag:
  `git tag vX.Y.Z <main-commit> && git push origin vX.Y.Z`. The tag push makes
  GitHub build + push the image and run the prod deploy trigger, which applies
  the version gate (`version-gate` step) — if the tag isn't reachable from
  `main` or isn't the newest `v*` version, the deploy step logs `deploy skipped
  — version gate did not approve …` and does not roll out (the image is already
  on ghcr.io for inspection / manual rollout). The deployed version is recorded
  as the `APP_VERSION` env var on the service (`gcloud run services describe
  pert-li --region=europe-west1 --format='value(spec.template.spec.containers[0].env)'`).
- **Rollback**: `gcloud run services update-traffic <service> --region=europe-west1 --to-revisions=<prev>=100`
  (`<service>` is `pert-li` for prod, `pert-li-staging` for staging).

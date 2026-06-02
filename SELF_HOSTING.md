# Self-hosting pert.li

pert.li is MIT-licensed and ships as a single Docker image
(`ghcr.io/<owner>/pert.li:<tag>`, built from the `Dockerfile` in this repo).
Everything below assumes you want to run it on your own infrastructure — see
[`DEPLOY.md`](./DEPLOY.md) for the Cloud Run-specific recipe.

## Deployment options

| Option | Best for | Effort | Production-ready |
|---|---|---|---|
| [`docker compose`](#docker-compose) | Single host, small team | 5 min | Yes — with TLS in front |
| [Kubernetes](#kubernetes) | Existing cluster | 15 min | Yes — single replica |
| Cloud Run | Google Cloud users | See [DEPLOY.md](./DEPLOY.md) | Yes |
| Bare Node | Custom infra | Bring your own systemd unit | Yes |

All four boot the same image and read the same environment variables. Pick
based on what you already operate.

## Required environment

The minimum to boot a usable instance:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Full Postgres URL. Vanilla Postgres, RDS, Cloud SQL, Neon, anything that speaks the wire protocol. Leave unset to use an in-process PGLite at `LOCAL_PGLITE_DIR` — **dev-only**, see [PGLite caveat](#pglite-in-production). |
| `BETTER_AUTH_SECRET` | Cookie-signing secret. Generate with `pnpm dlx @better-auth/cli secret`. Must be at least 32 bytes; reusing the value from another deployment breaks all existing sessions. |
| `BETTER_AUTH_URL` | The public URL the app is reachable on (`https://pert.example.com`). Used for cookie domain and OAuth callbacks — if it's wrong, sign-in silently fails. |

That's enough to render the UI and let users sign up via email+password. To
actually deliver magic-link emails, AI chat, or OIDC SSO, see the
[optional configuration](#optional-configuration) below.

## Docker compose

The fastest path. The repo ships a [`docker-compose.yml`](./docker-compose.yml)
that runs the app plus a Postgres 16 sidecar with a named volume for
persistence.

```bash
git clone https://github.com/<owner>/pert.li.git
cd pert.li
cp .env.example .env
# Edit .env: at minimum, set BETTER_AUTH_SECRET and POSTGRES_PASSWORD.
docker compose up -d
open http://localhost:8080
```

On first start the app container's entrypoint applies SQL migrations from
`./drizzle/` (bundled into the image) to the Postgres sidecar. Subsequent
starts are idempotent — re-running against an up-to-date schema is a no-op.

**Putting it behind TLS.** docker-compose itself doesn't terminate TLS.
The two common patterns:

1. **Caddy reverse proxy.** Add a second service running `caddy` with a
   `Caddyfile` containing `pert.example.com { reverse_proxy app:8080 }`.
   Caddy provisions a Let's Encrypt cert automatically.
2. **Existing reverse proxy on the host** (nginx, traefik, …). Bind the
   app to `127.0.0.1:8080` only and proxy through your existing setup.

Either way, set `BETTER_AUTH_URL=https://pert.example.com` in `.env` once
TLS is in place — Better Auth marks its cookies `Secure` and they will
silently fail to round-trip over plain HTTP.

## Kubernetes

The [`deploy/k8s/`](./deploy/k8s/) directory ships two ready-to-apply
topologies:

- [`postgres-statefulset/`](./deploy/k8s/postgres-statefulset/) — app
  Deployment + Postgres StatefulSet + PVC. All-in-one, single cluster.
- [`external-postgres/`](./deploy/k8s/external-postgres/) — app Deployment
  only. You provide Postgres via `DATABASE_URL` (RDS, Cloud SQL, …).

```bash
kubectl create namespace pertli
kubectl -n pertli create secret generic pertli \
  --from-literal=BETTER_AUTH_SECRET="$(pnpm dlx @better-auth/cli secret)" \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 32)" \
  --from-literal=ANTHROPIC_API_KEY="sk-ant-..."

kubectl -n pertli apply -f deploy/k8s/postgres-statefulset/
```

See [`deploy/k8s/README.md`](./deploy/k8s/README.md) for the full walkthrough.

### Replica count and multi-instance limitation

Both topologies pin the app Deployment to `replicas: 1`. The Automerge sync
server holds live document state in process; two replicas would only see
each other's edits after a hard reload (durable state still flows through
Postgres). Multi-instance fan-out (Redis pub/sub between replicas) is on
the roadmap — until then, scale **vertically**: more memory / CPU on the
single pod, not more pods.

### Ingress and WebSocket timeouts

The collaborative sync runs over a long-lived WebSocket at `/sync`. Most
ingress controllers proxy WS by default, but nginx-ingress needs the
read/send timeouts bumped (the manifests already set `3600s`) or sessions
get cut every minute. Traefik, Contour, and Cilium are fine out of the box.

## Optional configuration

All optional — leave unset to disable the feature.

### LLM provider (AI chat assistant)

Auto-detect order is **Anthropic → OpenAI → Gemini**; the first key found
wins. Override with `LLM_PROVIDER` / `LLM_MODEL`. The OpenAI adapter
accepts an `OPENAI_BASE_URL` so it can talk to any OpenAI-compatible `/v1`
endpoint — **Azure OpenAI, OpenRouter, LM Studio, Ollama, vLLM, llama.cpp,
corporate LLM gateways**.

```env
ANTHROPIC_API_KEY=sk-ant-...
# OR
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=http://ollama.internal:11434/v1   # optional
LLM_MODEL=llama3.1:70b                            # optional
OPENAI_API_FORMAT=                                # optional: responses | chat-completions
# OR
GEMINI_API_KEY=AIza...
```

When `OPENAI_BASE_URL` is set, requests go to the classic
`/v1/chat/completions` API (which is what most OpenAI-compatible servers
implement); against api.openai.com the newer `/v1/responses` API is used.
Set `OPENAI_API_FORMAT` to force one or the other — e.g.
`OPENAI_API_FORMAT=responses` for an Azure OpenAI endpoint that supports
the Responses API.

Without a key set, the chat dock disables itself — the rest of the app
(planning, sync, OIDC sign-in, etc.) still works.

### Email (magic-link sign-in)

Two transports. SMTP takes precedence when both are set.

**SMTP** (preferred for on-prem):

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
# SMTP_SECURE=1   # force TLS-from-start; auto-detected from port otherwise
SMTP_USER=apikey
SMTP_PASS=...
SMTP_FROM=noreply@example.com
```

**Resend** (the hosted default — also works on-prem if you'd rather not
operate SMTP):

```env
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@yourdomain.com   # must be a verified Resend sender
```

Without either, magic links are logged to stdout. Useful for dev; do not
ship this way to users.

### OIDC single sign-on

A single OIDC provider (Entra ID, Okta, Keycloak, Authentik, custom IdP):

```env
OIDC_PROVIDER_ID=entra             # URL segment; default "oidc"
OIDC_PROVIDER_NAME=Microsoft       # button label; default "SSO"
OIDC_DISCOVERY_URL=https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_SCOPES=openid,email,profile   # default
```

Register `<BETTER_AUTH_URL>/api/auth/oauth2/callback/<OIDC_PROVIDER_ID>` as
the redirect URI with your IdP. Leaving these unset hides the SSO button
on `/signin`.

### Privacy policy

The built-in `/privacy` route states pert.li sets no analytics or tracking
cookies — only functional ones for sign-in and OAuth state. To redirect to
your own policy page instead:

```env
PRIVACY_POLICY_URL=https://yourdomain.com/legal/privacy
```

## Operational notes

### Backups

Postgres is the source of truth — everything else (Automerge documents,
audit log, user state) lives there. Standard PG backup tooling applies:

```bash
# docker compose
docker compose exec postgres pg_dump -U pertli -d pertli > backup-$(date +%F).sql

# k8s (postgres-statefulset topology)
kubectl -n pertli exec statefulset/postgres -- \
  pg_dump -U pertli -d pertli > backup-$(date +%F).sql
```

For PVC-backed deployments, a volume snapshot (Velero, the cluster's
native VolumeSnapshot resource, or the cloud provider's disk snapshot) is
typically faster to restore than `pg_dump`. Whichever you pick, **rehearse
the restore** before you need it.

### Upgrades

```bash
# docker compose
docker compose pull
docker compose up -d           # entrypoint re-applies any new migrations

# k8s
kubectl -n pertli set image deployment/pertli app=ghcr.io/<owner>/pert.li:<new-tag>
kubectl -n pertli rollout status deployment/pertli
```

Migrations are forward-only and run automatically. If you'd rather control
when they run, set `SKIP_MIGRATE=1` on the app container and apply them
out-of-band:

```bash
# Run migrations as a one-shot job
kubectl -n pertli run pertli-migrate --rm -it --restart=Never \
  --image=ghcr.io/<owner>/pert.li:<tag> \
  --env="DATABASE_URL=$(kubectl -n pertli get secret pertli -o jsonpath='{.data.DATABASE_URL}' | base64 -d)" \
  --command -- node ./scripts/migrate.mjs
```

### Hardening checklist

- [ ] `BETTER_AUTH_SECRET` is unique per deployment, generated fresh.
- [ ] App is reachable only via HTTPS. `BETTER_AUTH_URL` uses `https://`.
- [ ] Postgres is not exposed to the public internet. Compose: don't
      uncomment the `ports:` line; k8s: the service is `ClusterIP` /
      headless, which is the default.
- [ ] Backups verified end-to-end (restore into a scratch DB at least
      once). Off-host copy if the cluster itself can fail.
- [ ] LLM API keys + OIDC client secret have appropriate rotation.
- [ ] Container image pinned to a specific tag (not `latest`) — see the
      published tags at `ghcr.io/<owner>/pert.li`.
- [ ] Resource limits on the app pod (the manifests default to 1 GiB
      memory; adjust to your workload). Automerge documents grow over time;
      monitor `automerge_storage` table size.

## PGLite in production

The repo's database layer transparently falls back to in-process
[PGLite](https://github.com/electric-sql/pglite) when `DATABASE_URL` is
unset — great for `pnpm dev` (zero-config first-run) and for the e2e
suite. **Don't run production this way yet.** Drizzle Kit's `pushSchema`
hangs against the Rolldown-bundled schema object emitted by the Nitro
production build, so first-start initialization doesn't reliably complete.
For now, every documented topology above uses real Postgres (whether
embedded as a sidecar / StatefulSet, or external).

If you're looking for "smallest possible deployment," the
[`docker-compose.yml`](./docker-compose.yml) with the bundled Postgres is
~150 MB of memory at idle. That's already close to PGLite's footprint and
gives you a real DB you can `pg_dump`.

## Telemetry

pert.li does not phone home. The app makes no outbound network calls
beyond:

- The LLM provider you configured (if any).
- Resend (if you configured the magic-link transport).
- The OIDC IdP you configured (if any).
- The user's browser fetching its own assets from your origin.

There is no analytics SDK, no error-tracking SDK, no usage telemetry.

## Getting help

- **Bug reports / feature requests:** GitHub issues on the repo.
- **Security issues:** see [`SECURITY.md`](./SECURITY.md) — do not open a
  public issue.
- **Operational questions:** start a Discussion on the repo.

# Kubernetes manifests

Two ready-to-apply topologies for self-hosting pert.li on Kubernetes.

| Topology | When to use | Replicas | Persistence |
|---|---|---|---|
| [`postgres-statefulset/`](./postgres-statefulset/) | The default. All-in-one, single-cluster deployment. | App: 1 · DB: 1 | DB on PVC |
| [`external-postgres/`](./external-postgres/) | You already operate Postgres (RDS, Cloud SQL, on-prem, …). | App: 1 (see below) | External |

Both topologies are plain `kubectl apply -f` manifests — no Helm chart, no
Kustomize overlay. Copy the directory, edit the obvious bits (hostname,
secret values, storage class, image tag), and apply.

## Quick start

```bash
# Generate the auth secret + a strong Postgres password.
export BETTER_AUTH_SECRET=$(pnpm dlx @better-auth/cli secret)
export POSTGRES_PASSWORD=$(openssl rand -base64 32)
export ANTHROPIC_API_KEY=...      # or OPENAI_API_KEY / GEMINI_API_KEY

# Render the Secret from your environment, then apply the whole stack.
kubectl create namespace pertli
kubectl -n pertli create secret generic pertli \
  --from-literal=BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"

kubectl -n pertli apply -f deploy/k8s/postgres-statefulset/
```

The first rollout takes ~1 min: the app pod's init container waits for
Postgres to be ready, then applies the schema migrations from
`./drizzle/` (bundled into the image).

## Replica count

Both topologies pin the app `Deployment` to `replicas: 1`. The Automerge
sync server keeps live document state in-process, so two replicas would only
see each other's edits after a hard reload (durable state still flows
through Postgres). Multi-instance fan-out via Redis pub/sub is on the
roadmap — until then, scale vertically.

## PGLite-on-PVC option

The earlier roadmap entry was to allow `replicas=1` + a PVC mounted at
`/app/.data/pglite` with no Postgres at all. This works in local dev but
hangs on schema initialization when run from the Nitro production bundle
(drizzle-kit's `pushSchema` doesn't recognize the Rolldown-bundled schema
object). For now, prefer the [`postgres-statefulset/`](./postgres-statefulset/)
topology — it's almost as simple to operate and avoids the bundling foot-gun.

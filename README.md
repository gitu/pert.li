# pert.li

Collaborative PERT planning with an AI co-planner.

pert.li turns rough scopes into PERT charts you can actually steer: three-point estimates (optimistic / most likely / pessimistic), a deterministic critical path, nested containers, and live multi-user edits. Every keystroke syncs through [Automerge](https://automerge.org) — no save button, no merge conflicts — and a built-in chat assistant can read your plan and create tasks, set estimates, and wire dependencies on your behalf.

![Network view with the critical path highlighted](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/network.png)

## Quick start

Requires Node 24+ and pnpm 11 (corepack will install it for you).

```bash
corepack enable
corepack prepare pnpm@11.3.0 --activate

pnpm install
pnpm dev          # http://localhost:3000
```

No database setup is needed for first-run dev. The Vite plugin boots an in-process Postgres ([PGLite](https://github.com/electric-sql/pglite)) at `./.data/pglite`, pushes the Drizzle schema, and is ready in ~2 s. Data persists between restarts; delete the directory to start fresh.

To use a real Postgres instead, drop a `DATABASE_URL` into `.env.local` and Drizzle will hit it directly. To re-enable the [Neon Launchpad](https://neon.new) provisioning flow (claimable database, 72 h expiry) set `USE_NEON_PROVISION=1`.

## Features

- **PERT, done properly.** Three-point estimates, automatic ES / EF / LS / LF, slack, and a critical path that updates as you type. The CPM engine is pure TypeScript with property tests in `src/lib/pert/`.
- **Five synchronized views.** Network canvas (React Flow + ELK auto-layout), Timeline (Gantt), Table (inline editing + grouping with PERT confidence bands), Matrix (dependency toggle), and Tree list — edits in any view sync to the others live.
- **Nested containers.** Group related tasks into sub-projects with their own entry/exit interfaces. The schedule rolls up automatically.
- **Real-time collaboration.** Automerge CRDT under the hood, broadcast within a browser and WebSocket-synced across browsers. Two people see the same critical path without stepping on each other's keystrokes.
- **AI co-planner.** A chat dock that can ingest a brief, propose a task breakdown, set estimates, wire dependencies, and walk new users through the tool. Auto-detects the provider you've configured ([Anthropic](https://www.anthropic.com) → [OpenAI](https://openai.com) → [Gemini](https://ai.google.dev), by key presence) and accepts any OpenAI-compatible endpoint via `OPENAI_BASE_URL` (Azure, OpenRouter, LM Studio, Ollama, vLLM, llama.cpp).
- **`.pert.json` import / export.** Stable interchange format with a JSON Schema, nested dependencies, and a 31-test round-trip suite.
- **Mobile UI.** Below 768 px the desktop layout is replaced by a read-only-first shell with tap-friendly view variants. Toggle the pencil to edit.
- **Auth out of the box.** Passwordless email (via [Resend](https://resend.com)) plus a single optional OIDC SSO provider (Entra ID, Okta, Keycloak, Authentik, …).
- **Self-hostable.** Pushes an image to `ghcr.io/<owner>/pert.li` on every tag; the multi-stage `Dockerfile` produces a slim Node image. See `DEPLOY.md` for the Cloud Run recipe.

## The views

The same project, four ways. Edit in any view; the others stay in sync.

| | |
| :---: | :---: |
| [![Timeline view — Gantt-style schedule](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/timeline.png)](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/timeline.png) | [![Table view — inline editing with ES/EF/slack](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/table.png)](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/table.png) |
| **Timeline** — Gantt with the critical path in red and slack in gray. | **Table** — inline three-point estimates, computed ES/EF/slack, critical/slack badges. |
| [![Matrix view — predecessor/successor toggles](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/matrix.png)](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/matrix.png) | [![AI chat assistant pinned beside the canvas](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/chat.png)](https://raw.githubusercontent.com/gitu/pert.li/main/docs/screenshots/chat.png) |
| **Matrix** — click a cell to toggle a finish→start dependency. | **AI co-planner** — pin the chat dock beside the canvas and let it create tasks for you. |

## Environment

Drop these in `.env.local`. Everything is optional in dev — the chat assistant disables itself if no LLM key is present, and PGLite kicks in if there's no `DATABASE_URL`.

```env
# Database — unset to use the local PGLite fallback at ./.data/pglite
DATABASE_URL=

# Auth — generate with `pnpm dlx @better-auth/cli secret`
BETTER_AUTH_SECRET=

# LLM provider — set one of these (Anthropic is preferred when multiple are set)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=

# Optional: override the auto-detect order, the model, or the OpenAI base URL
LLM_PROVIDER=             # openai | anthropic | gemini
LLM_MODEL=
OPENAI_BASE_URL=          # any OpenAI-compatible /v1 endpoint

# Optional: passwordless email (without either, /signin uses a dev console fallback).
# SMTP takes precedence over Resend when both are set.
SMTP_HOST=                # e.g. smtp.example.com — set this to use SMTP
SMTP_PORT=587             # 465 = TLS-from-start, 587 = STARTTLS (default)
SMTP_USER=
SMTP_PASS=
SMTP_FROM=                # noreply@yourdomain.com
RESEND_API_KEY=
RESEND_FROM_EMAIL=        # verified Resend sender

# Optional: a single OIDC SSO provider — leave unset to hide the SSO button
OIDC_PROVIDER_ID=         # default "oidc"; URL segment for the callback
OIDC_PROVIDER_NAME=       # button label; default "SSO"
OIDC_DISCOVERY_URL=       # https://idp.example.com/.well-known/openid-configuration
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_SCOPES=              # comma-separated; default "openid,email,profile"

# Optional: external privacy policy URL (defaults to the built-in /privacy page)
PRIVACY_POLICY_URL=
```

Register `<app-origin>/api/auth/oauth2/callback/<OIDC_PROVIDER_ID>` as the redirect URI with your IdP.

## Scripts

```bash
pnpm dev               # Vite dev server on :3000
pnpm build             # Production build (Nitro server output in .output/)
pnpm preview           # Preview the production build
node .output/server/index.mjs   # Run the built server

pnpm test              # Vitest (unit + property tests)
pnpm e2e               # Playwright e2e on a built server (port 3100)
pnpm storybook         # Storybook on :6006
pnpm storybook:ci      # Storybook + test-runner together

pnpm check             # Biome — lint + format + organize-imports (preferred pre-commit)
pnpm lint              # Biome lint only
pnpm format            # Biome format (writes)

pnpm db:push           # Push schema in src/db/schema.ts to the DB
pnpm db:generate       # Generate a SQL migration into ./drizzle/
pnpm db:migrate        # Apply migrations
pnpm db:studio         # Drizzle Studio
```

## Tech stack

- [**TanStack Start**](https://tanstack.com/start) meta-framework on top of Vite + [Nitro](https://nitro.build) (Node-compatible server output), with TanStack Router (file-based routes in `src/routes/`), Query, Store, React DB, and the TanStack AI SDK.
- [**React 19**](https://react.dev) with the React Compiler — no manual `useMemo` / `useCallback` unless profiling says otherwise.
- [**Drizzle ORM**](https://orm.drizzle.team) on [Neon Postgres](https://neon.tech) in prod, [PGLite](https://github.com/electric-sql/pglite) in dev.
- [**Automerge**](https://automerge.org) CRDT for real-time collaboration over WebSocket (server-authoritative) + BroadcastChannel (tab-to-tab).
- [**Better Auth**](https://better-auth.com) for email + OIDC, on top of Drizzle.
- [**Tailwind CSS v4**](https://tailwindcss.com) and [shadcn/ui](https://ui.shadcn.com) (`new-york` style, `zinc` base).
- [**React Flow**](https://reactflow.dev) + [ELK](https://eclipse.dev/elk/) for the canvas, [TanStack Table](https://tanstack.com/table) for the table view.
- [**Biome**](https://biomejs.dev) for linting / formatting (tabs, double quotes).

## Self-hosting

pert.li is MIT-licensed and ships as a Docker image (`ghcr.io/<owner>/pert.li:<tag>`, published on every git tag). The fastest path is `docker compose`:

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET, POSTGRES_PASSWORD, an LLM key
docker compose up -d
open http://localhost:8080
```

The container entrypoint applies SQL migrations from `./drizzle/` on first start, then boots the bundled Nitro server. See [`SELF_HOSTING.md`](./SELF_HOSTING.md) for the full guide — Kubernetes manifests (in [`deploy/k8s/`](./deploy/k8s/)), TLS / reverse-proxy setup, backups, upgrades, optional SMTP / OIDC / LLM configuration, and the current multi-instance limitation.

For Google Cloud Run specifically, see [`DEPLOY.md`](./DEPLOY.md). For other Nitro presets (Vercel, Netlify, Cloudflare Workers, AWS Lambda, …), the build output is portable; see <https://nitro.build/deploy>.

## Contributing

Project conventions live in [`CLAUDE.md`](./CLAUDE.md) — testing rules (Vitest + Storybook + Playwright), styling, file layout, and a few `gotchas` worth knowing before opening a PR. New to the codebase? Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the contributor quickstart.

## License

[MIT](./LICENSE). Security disclosures: see [`SECURITY.md`](./SECURITY.md).

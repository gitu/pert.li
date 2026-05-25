# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**pert.li** is a TanStack Start chat application powered by Claude (Anthropic). It pairs the TanStack ecosystem (Router, Query, Store, React DB, AI) with Drizzle ORM on Neon Postgres, Better Auth, and an MCP endpoint.

## Commands

Package manager is **pnpm** (`.npmrc` sets `legacy-peer-deps=true`; the `pnpm.onlyBuiltDependencies` block in `package.json` only applies under pnpm).

```bash
pnpm dev               # Vite dev server on http://localhost:3000
pnpm build             # Production build (Nitro server output in dist/)
pnpm preview           # Preview the production build
node dist/server/index.mjs   # Run the built server (deploy target is Node-compatible)

pnpm test              # Vitest, run mode
pnpm test <pattern>    # Run a single test file or pattern (e.g. pnpm test button)
pnpm vitest            # Watch mode (use directly — no script alias)

pnpm lint              # Biome lint
pnpm format            # Biome format (writes)
pnpm check             # Biome check (lint + format + organizeImports) — preferred pre-commit

pnpm db:push           # Push schema in src/db/schema.ts to the DB (dev workflow)
pnpm db:generate       # Generate a SQL migration into ./drizzle/
pnpm db:migrate        # Apply migrations
pnpm db:studio         # Open Drizzle Studio

pnpm storybook         # Storybook on :6006
```

Adding shadcn/ui components (from `.cursorrules`):

```bash
pnpm dlx shadcn@latest add <component>
```

Components land under `src/components/ui/` (alias `#/components/ui`). Style is `new-york`, base color `zinc`, icon set `lucide` (see `components.json`).

## Architecture

### Meta-framework: TanStack Start

`vite.config.ts` composes the entire dev/build pipeline: `tanstackStart()` (Start meta-framework), `nitro()` (server output), `tailwindcss()`, `viteReact()`, `babel(reactCompilerPreset())` (React Compiler — avoid manual `useMemo`/`useCallback` unless profiling says otherwise), `devtools()`, and the local `neon` plugin (see "Data layer" below).

### Routing — file-based, do not hand-edit the tree

Routes live in `src/routes/`. The router config is in `src/router.tsx`; SSR + Query are wired with `setupRouterSsrQueryIntegration`. `src/routeTree.gen.ts` is **generated** by `@tanstack/router-plugin` — never edit it (Biome already ignores it). To add a route, drop a new file in `src/routes/`; the tree regenerates on dev.

Root shell: `src/routes/__root.tsx`. Server-only endpoints use the `server.handlers.{GET,POST}` shape inside a route file:
- `src/routes/api/auth/$.ts` — catch-all Better Auth handler
- `src/routes/mcp.ts` — MCP endpoint, dispatches via `src/utils/mcp-handler.ts` (tools defined in `src/mcp-todos.ts`)

For client-server calls inside a route, prefer `createServerFn` from `@tanstack/react-start` over a hand-rolled fetch.

### Data layer

- **Server-side DB client:** `src/db.ts` — lazy singleton over `@neondatabase/serverless`. Server code reads `DATABASE_URL`.
- **Schema:** `src/db/schema.ts` (Drizzle). Drizzle config in `drizzle.config.ts` writes migrations to `./drizzle/`.
- **Dev seeding:** `db/init.sql` is the seed script run by the custom `neon-vite-plugin.ts` (wraps `vite-plugin-neon-new`). On first `pnpm dev`, it provisions a **claimable Neon database (72h expiry)** and sets `DATABASE_URL` for you — no manual setup needed. Note: `db/init.sql` and `src/db/schema.ts` can drift; reconcile before generating migrations.
- **Client-side state:** TanStack React DB collections live in `src/db-collections/` (Zod-validated, in-memory). TanStack Query is set up in `src/integrations/tanstack-query/root-provider.tsx` and injected through router context.

### Auth

Better Auth, configured in `src/lib/auth.ts`; client helper in `src/lib/auth-client.ts`. All HTTP traffic goes through `/api/auth/*` (the catch-all route). `BETTER_AUTH_SECRET` must be set; generate with `pnpm dlx @better-auth/cli secret`.

### Imports & path aliases

Both `#/*` and `@/*` resolve to `./src/*` (`tsconfig.json` + `package.json#imports`). shadcn's `components.json` uses `#/` — match that style for new code.

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` (no `tailwind.config.js` — config lives in `src/styles.css` using v4 `@theme`/`@import` syntax). `cn()` helper at `src/lib/utils.ts`. Components use Class Variance Authority for variants.

### Tooling rules

- **Biome 2.x** is the linter and formatter: **tabs** for indentation, **double quotes** in JS/TS. Ignores `src/routeTree.gen.ts` and `src/styles.css`. Run `pnpm check` before committing.
- TypeScript is strict (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`), `moduleResolution: "bundler"`, target ES2022.

## Environment

Required in `.env.local`:

```env
DATABASE_URL=            # auto-populated by neon plugin in dev
ANTHROPIC_API_KEY=
BETTER_AUTH_SECRET=
```

The chat handler auto-detects the LLM provider (Anthropic → OpenAI → Gemini, by key presence). To use a different one, set `LLM_PROVIDER=openai|anthropic|gemini` and (optionally) `LLM_MODEL=<id>`. The OpenAI adapter accepts an `OPENAI_BASE_URL` override so it can talk to any OpenAI-compatible `/v1` endpoint — Azure OpenAI, OpenRouter, LM Studio, Ollama, vLLM, llama.cpp. Defaults to `https://api.openai.com/v1` when unset.

Optional — single OIDC SSO provider (custom on-prem IdP, Microsoft Entra ID / Azure AD, Okta, Keycloak, Authentik). Leaving these unset hides the SSO button on `/signin`.

```env
OIDC_PROVIDER_ID=        # defaults to "oidc"; URL segment for the callback
OIDC_PROVIDER_NAME=      # button label ("Continue with {name}"); defaults to "SSO"
OIDC_DISCOVERY_URL=      # https://idp.example.com/.well-known/openid-configuration
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_SCOPES=             # comma-separated; defaults to "openid,email,profile"
```

Register `<app-origin>/api/auth/oauth2/callback/<OIDC_PROVIDER_ID>` as the redirect URI with the IdP. For Entra ID the discovery URL is `https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`.

Optional — privacy policy URL override:

```env
PRIVACY_POLICY_URL=      # if set, /privacy redirects here instead of the default
```

The built-in `/privacy` route documents what cookies pert.li stores (only functional ones for sign-in / OAuth state) and explicitly states no analytics or tracking are used. Self-hosted deployments that need their own legal copy can either replace `src/routes/privacy.tsx` or set this env var to redirect users to an external policy page.

## Testing rules

Every shipped feature must satisfy these. "Done" includes the test rig — a feature without test scaffolding is not merged.

### Three layers, all required

Every feature needs coverage at the layers that apply to it. They're complementary, not substitutes.

| Layer | Tool | Covers | When required |
|---|---|---|---|
| **Unit / property** | Vitest (+ `fast-check`) | Pure functions, hooks (`@testing-library/react`), Zod schemas, scheduling engines, reducers | Whenever logic is testable in isolation. Anything in `src/lib/` defaults to "yes." |
| **Component / visual** | Storybook | Reusable components in `src/components/` — visual states (default, loading, empty, error) and `play` interaction tests | Every new or touched component file under `src/components/` (excluding vendored `ui/` primitives and `storybook/` demos) |
| **End-to-end** | Playwright MCP (or `@playwright/test` once we set up CI) | Real user flows in the running app: sign-in, sync across tabs, upload, etc. | Every new route, every cross-component flow, every collaborative behavior |

A feature that introduces a pure function, a new component, AND a new flow needs all three. A feature that only refactors an existing component needs at least the component layer refreshed. Don't skip a layer because another one happens to exercise the same code path — they catch different classes of bug (logic regression vs. visual drift vs. integration breakage).

### Rules

1. **Real-browser verification is mandatory for end-to-end.** Drive the feature through Playwright MCP (or open it manually) and exercise the actual behavior: click, type, observe state, assert. `curl /route → 200` proves only that the route didn't crash during SSR — it is NOT a feature test.
2. **Browser console must be clean after each interaction.** Errors and warnings count as failures. Investigate before declaring done; don't ignore "harmless" warnings without explaining why in a comment or memory.
3. **Sync features need a two-context check.** Anything touching Automerge or shared state: edit in tab/context A, observe propagation in tab/context B. Use `mcp__plugin_playwright_playwright__browser_tabs` (same browser → BroadcastChannel) and a fresh context (different browser → WebSocket only) when both matter.
4. **Persistence features need a hard reload.** If storage is involved (IndexedDB, NodeFS adapter, Postgres), navigate away and back (or hard reload) and confirm state survives. For server-side stores, also verify the on-disk/db record exists.
5. **Controlled inputs over `defaultValue` for collaborative state.** With Automerge-backed values: use `value={doc.x}` + `onChange`. `defaultValue` only fires once and won't reflect remote updates — burned by this in Phase 1.
6. **Storybook coverage rules.** Every new or touched reusable component in `src/components/` ships with a `*.stories.tsx` covering the default plus meaningful variants (loading/empty/error/interactive). Use `play` functions for interaction assertions when the component has non-trivial behavior. Storybook runs through its own isolated vite config (`.storybook/vite.config.ts`) — don't let it pick up the root `vite.config.ts` (Nitro's `configureServer` will crash). Don't backfill stories for unmodified files.
7. **Property tests for pure logic.** Anything in `src/lib/pert/` (engine, projection, hierarchy) gets `fast-check` property tests alongside example tests. Pure functions have no excuse for being only exercised through integration.
8. **Diagnose before re-running.** When a test fails or surprises you, fix the underlying bug — not the test methodology — until you have proof that the methodology itself is wrong. Example: if `browser_type` doesn't trigger React's `onChange`, that's a real bug unless real keyboard input also fails to fire it.
9. **Stop dev servers between sessions.** `pnpm dev` and `pnpm storybook` both grab ports (3000 and 6006). Use `TaskStop` / `pkill -f "vite dev"` before walking away.
10. **What NOT to test:** vendored scaffolding (shadcn primitives under `src/components/ui/`, `src/components/storybook/` demos) has upstream tests — don't re-cover them. Framework concerns (TanStack Router/SSR shell, Better Auth catch-all) likewise.

## AI assistant system prompt

The in-app chat assistant's system prompt lives in `src/lib/ai/chat.server.ts` (`SYSTEM_PROMPT`). It contains an **ABOUT PERT.LI** block that enumerates the visible product surfaces — views, panels, controls, chat dock chrome, sign-in flow — so the assistant's tutorials and walkthroughs match what the user actually sees.

When you ship a change that renames, adds, or removes a top-level surface (a view tab, an inspector control, a sidebar entry, a tool, a major route, the chat dock chrome, a theme/account-menu option), update that block **before** declaring the feature done. If you're unsure whether a change qualifies, verify by re-reading the section against the running UI; if anything reads as stale, fix it. Tool-level changes (adding/removing a `*Tool` in `src/lib/ai/tools.ts`) also need the matching `TOOLS —` bullet updated.

## Demo / scaffold files

Files prefixed with `demo` (and the `src/components/storybook/` examples) are safe to delete — they're scaffolding from `create-tanstack`.

## Attribution

Do **not** add Claude/Anthropic attribution to anything in this repo: no `Co-Authored-By: Claude …` trailers on commits, no `🤖 Generated with Claude Code` footers on PR bodies, no "written by Claude" comments in code. Commit messages and PR descriptions should read as if written by the human author.

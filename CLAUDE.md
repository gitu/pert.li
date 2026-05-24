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

Better Auth, configured in `src/lib/auth.ts`; client helper in `src/lib/auth-client.ts`. All HTTP traffic goes through `/api/auth/*` (the catch-all route). `BETTER_AUTH_SECRET` must be set; generate with `npx -y @better-auth/cli secret`.

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

## Demo / scaffold files

Files prefixed with `demo` (and the `src/components/storybook/` examples) are safe to delete — they're scaffolding from `create-tanstack`.

## Attribution

Do **not** add Claude/Anthropic attribution to anything in this repo: no `Co-Authored-By: Claude …` trailers on commits, no `🤖 Generated with Claude Code` footers on PR bodies, no "written by Claude" comments in code. Commit messages and PR descriptions should read as if written by the human author.

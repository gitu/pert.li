# Contributing to pert.li

Thanks for considering a contribution. pert.li is MIT-licensed; by submitting
a pull request you agree to license your contribution under the same terms.

## Before you start

- For anything beyond a small fix or doc tweak, open an issue first so we can
  agree on the shape before you spend time on it.
- Security issues: **do not** open a public issue — see
  [`SECURITY.md`](./SECURITY.md).

## Local setup

```bash
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install
pnpm dev          # http://localhost:3000
```

No database setup is needed for the first run — PGLite boots in-process at
`./.data/pglite`. See the [README](./README.md#environment) for the optional
env vars (LLM keys, SMTP, OIDC, …).

## Project conventions

- **Lint & format:** Biome 2.x with **tabs** and **double quotes**. Run
  `pnpm check` before committing — it does lint + format + import-organize in
  one pass.
- **Types:** strict TypeScript (`noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`). No `any`
  escape hatches in PRs.
- **Paths:** both `#/*` and `@/*` resolve to `./src/*`. shadcn-generated code
  uses `#/`; match that style.
- **React:** React 19 with the React Compiler. Avoid manual `useMemo` /
  `useCallback` unless profiling says otherwise.
- **shadcn components:** add new ones with
  `pnpm dlx shadcn@latest add <component>`.

## Testing

Every shipped feature needs the layers that apply to it — see the
**Testing rules** section of [`CLAUDE.md`](./CLAUDE.md#testing-rules) for the
authoritative list. Short version:

| Layer | Tool | When |
|---|---|---|
| Unit / property | Vitest (+ `fast-check`) | Pure functions, hooks, schemas, engines, reducers. |
| Component / visual | Storybook | Reusable components under `src/components/`. |
| End-to-end | Playwright (`./e2e/`) | New routes, cross-component flows, collaboration. |

```bash
pnpm test        # Vitest
pnpm storybook   # Storybook on :6006
pnpm e2e         # Playwright (its own dev server on :3100)
```

Real-browser verification is mandatory for end-to-end work — `curl /route →
200` is not a feature test. Sync features need a two-tab check; persistence
features need a hard reload.

## Pull requests

- Keep PRs focused. Mixing a refactor into a feature PR makes review harder.
- Squash unrelated commits before opening the PR.
- The PR description should answer **what** changed and **why**. Link to the
  issue if there is one. No need to repeat the diff in prose.
- CI must be green before merge. If a flake is blocking you, say so on the PR
  rather than re-running silently.

## Releases

Releases are cut by maintainers via git tag. The `docker.yml` workflow
publishes `ghcr.io/<owner>/pert.li:<tag>` automatically. See
[`SELF_HOSTING.md`](./SELF_HOSTING.md) for the deploy story.

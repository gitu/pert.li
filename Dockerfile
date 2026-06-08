# syntax=docker/dockerfile:1.7
# Multi-stage build for pert.li. Produces a slim Node image that runs on
# Cloud Run, plain Docker, Kubernetes, or anywhere else Node 24 runs.
#
# Stage 1 (deps)      — fetch the full content-addressed store from the lockfile.
# Stage 2 (build)     — install all deps and compile TanStack Start to .output/.
# Stage 3 (prod-deps) — install ONLY production deps (for externalized packages
#                       like @automerge/* that Nitro doesn't bundle).
# Stage 4 (runner)    — copy .output/ + the prod node_modules + migration
#                       scripts + the entrypoint into a slim image.

ARG NODE_VERSION=24.0.0

# ---------- deps ----------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

# Install pnpm directly via npm. Corepack's bundled signing keys in
# Node 22.13 / 24 are stale for newer pnpm releases ("Cannot find
# matching keyid"); going through npm sidesteps the signature dance.
RUN npm install -g pnpm@11.3.0

COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
# `pnpm fetch` populates the content-addressed store from the lockfile;
# combined with `--offline --frozen-lockfile` below it gives reproducible,
# network-free installs in later stages.
RUN pnpm fetch

# ---------- build ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.3.0
COPY --from=deps /app /app
# Install BEFORE copying source so this layer caches across source-only commits.
# Its cache key is the `deps` stage above, which copies + fetches from the
# dependency manifests (package.json / pnpm-lock.yaml / .npmrc /
# pnpm-workspace.yaml) — so only a change to one of THOSE invalidates the
# install; ordinary source edits don't. `COPY --from=deps` already carries
# those manifests + the fetched store, so install needs no source tree.
# Postinstall builds of the `allowBuilds` packages (esbuild, lightningcss,
# @swc/core, @google/genai, protobufjs, ...) need to actually run, otherwise
# native bindings end up missing. `pnpm install --frozen-lockfile` honors
# the pnpm-workspace.yaml `allowBuilds` list without prompting in
# non-interactive contexts.
RUN pnpm install --offline --frozen-lockfile
COPY . .

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# CI passes `git describe --tags --always` here so the build can bake the
# version into the client bundle (see scripts/compute-version.mjs + the
# `process.env.VITE_APP_VERSION` line in vite.config.ts). Defaults to a
# clearly-fake string so a plain `docker build .` without --build-arg still
# ships, just without a precise version.
ARG APP_VERSION=0.0.0-unknown
ENV APP_VERSION=${APP_VERSION}

# build:pwa = `pnpm build` + service-worker generation (scripts/generate-sw.mjs)
# and sets VITE_PWA_ENABLED=1 so the client registers /sw.js. This gives
# deployed tabs an "update available" reload prompt + offline asset caching;
# a plain `pnpm build` ships neither (see src/lib/pwa/register-sw.ts).
RUN pnpm build:pwa

# ---------- prod-deps ----------
# @automerge/* is externalized (its ESM bundle references CJS-only
# `__dirname` for wasm path resolution; bundling crashes at startup).
# Externalized packages need to live in node_modules at runtime, so we
# install a clean production-only tree here and ship it alongside .output.
# `pnpm deploy` flattens symlinks into a real prod node_modules.
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@11.3.0
COPY --from=deps /app /app
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
RUN pnpm install --offline --frozen-lockfile --prod --ignore-scripts

# ---------- eval ----------
# Bring-your-own-LLM eval runner. NOT part of the default build (that's
# `runner`, the last stage) — build it explicitly with `--target eval`. Based
# on `build` so it carries the full source tree + dev dependencies + Vitest +
# the eval scenarios. The provider is chosen entirely at runtime via env
# (LLM_PROVIDER / OPENAI_BASE_URL / *_API_KEY), so the same image validates the
# prompt against Gemini, OpenAI, Anthropic, or any OpenAI-compatible
# self-hosted endpoint (Ollama, vLLM, LM Studio, corporate gateway). Example:
#
#   docker build --target eval -t pert-li-evals .
#   docker run --rm \
#     -e LLM_PROVIDER=openai \
#     -e OPENAI_BASE_URL=http://host.docker.internal:11434/v1 \
#     -e OPENAI_API_KEY=ollama -e LLM_MODEL=llama3.1 \
#     -e EVAL_REPEATS=3 -e EVAL_THRESHOLD=0.7 \
#     pert-li-evals
#
# (On Linux add `--add-host=host.docker.internal:host-gateway`.)
FROM build AS eval
WORKDIR /app
ENV NODE_ENV=test
ENTRYPOINT ["pnpm", "eval"]

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run injects PORT (default 8080). Nitro's node-server preset
# respects it automatically.
ENV PORT=8080
ENV AUTOMERGE_STORAGE=postgres
# Re-declare so the runner stage receives the build-arg too (ARGs don't
# carry across FROM lines). Exposed as ENV so ops can read the version with
# `printenv` without spelunking the bundled JS — the in-app footer already
# covers user-facing reads. The OCI image labels (incl. title + version) are
# applied at push time by docker/metadata-action in .github/workflows/docker.yml.
ARG APP_VERSION=0.0.0-unknown
ENV APP_VERSION=${APP_VERSION}

USER node

COPY --chown=node:node --from=build /app/.output ./.output
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
# Migration scripts + the SQL migrations they apply. Kept out of the bundle
# so they can be invoked / replaced without rebuilding the server.
COPY --chown=node:node --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --chown=node:node --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chown=node:node --from=build /app/drizzle ./drizzle

EXPOSE 8080
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]

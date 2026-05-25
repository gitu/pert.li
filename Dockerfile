# syntax=docker/dockerfile:1.7
# Multi-stage build for pert.li → Cloud Run.
#
# Stage 1 (deps)      — fetch the full content-addressed store from the lockfile.
# Stage 2 (build)     — install all deps and compile TanStack Start to .output/.
# Stage 3 (prod-deps) — install ONLY production deps (for externalized packages
#                       like @automerge/* that Nitro doesn't bundle).
# Stage 4 (runner)    — copy .output/ + the prod node_modules into a slim image.

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
COPY . .
# Postinstall scripts of `onlyBuiltDependencies` (esbuild, lightningcss,
# @swc/core, @google/genai, protobufjs, ...) need to actually run, otherwise
# native bindings end up missing. `pnpm install --frozen-lockfile` honors
# the package.json `pnpm.onlyBuiltDependencies` allow-list without
# prompting in non-interactive contexts.
RUN pnpm install --offline --frozen-lockfile

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

RUN pnpm build

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

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run injects PORT (default 8080). Nitro's node-server preset
# respects it automatically.
ENV PORT=8080
ENV AUTOMERGE_STORAGE=postgres

USER node

COPY --chown=node:node --from=build /app/.output ./.output
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules

EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]

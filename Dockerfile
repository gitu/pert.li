# syntax=docker/dockerfile:1.7
# Multi-stage build for pert.li → Cloud Run.
#
# Stage 1 (deps)   — install all dependencies once, cached on lockfile hash.
# Stage 2 (build)  — compile TanStack Start to .output/ (Nitro node-server).
# Stage 3 (runner) — copy only the standalone .output/ + minimum prod deps.

ARG NODE_VERSION=22.13.0

# ---------- deps ----------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

# Corepack ships pnpm; pin the version we test against. Keep this in sync
# with the pnpm version local devs use (the lockfile is pnpm 11+).
# Install pnpm directly via npm. Corepack's bundled signing keys in
# Node 22.13 are stale and reject pnpm 11.x releases ("Cannot find
# matching keyid"). Going through npm sidesteps the signature dance.
RUN npm install -g pnpm@11.3.0

COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
# `pnpm fetch` populates the content-addressed store from the lockfile;
# combined with `--offline --frozen-lockfile` below it gives reproducible,
# network-free installs in later stages.
RUN pnpm fetch

# ---------- build ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
# Install pnpm directly via npm. Corepack's bundled signing keys in
# Node 22.13 are stale and reject pnpm 11.x releases ("Cannot find
# matching keyid"). Going through npm sidesteps the signature dance.
RUN npm install -g pnpm@11.3.0
COPY --from=deps /app /app
COPY . .
# Postinstall scripts of `onlyBuiltDependencies` (esbuild, lightningcss,
# @swc/core, @google/genai, protobufjs, ...) need to actually run, otherwise
# native bindings end up missing. `pnpm install --frozen-lockfile` honors
# the package.json `pnpm.onlyBuiltDependencies` allow-list without
# prompting in non-interactive contexts.
RUN pnpm install --offline --frozen-lockfile

# Build args / env that affect the bundle.
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

RUN pnpm build

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run injects PORT (default 8080). Nitro's node-server preset
# respects it automatically.
ENV PORT=8080
ENV AUTOMERGE_STORAGE=postgres

# Drop privileges. The `node` user is bundled in the official image.
USER node

# The Nitro `node-server` preset emits a self-contained .output/ directory
# (server bundle + tiny native deps under .output/server/node_modules). We
# don't need package.json, lockfile, or src in the runtime image.
COPY --chown=node:node --from=build /app/.output ./.output

EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]

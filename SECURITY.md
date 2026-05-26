# Security Policy

## Reporting a vulnerability

If you believe you've found a security issue in pert.li, **please do not open a
public GitHub issue**. Instead, email **security@schr.ag** with:

- A description of the issue and the impact you believe it has.
- A minimal reproduction (commands, payloads, repro repo, or recording).
- The affected version / commit SHA, and the deployment topology you tested
  against (the published Docker image, a fork, a self-hosted build).

You should expect an acknowledgement within **3 business days**. We'll work
with you on a fix and a coordinated disclosure window — typically 30–90 days,
depending on severity and the upstream dependencies involved.

We do not run a paid bug bounty. We'll credit reporters in the release notes
unless you ask to remain anonymous.

## Supported versions

pert.li ships from `main`. Security fixes are released as a new tag on the
`ghcr.io/<owner>/pert.li` image. Older tags are not patched — pin to a recent
tag, or track `latest`, and plan to upgrade promptly when a security release
is published.

## Scope

In scope:

- The pert.li server (Nitro/Node), client, sync server (`/sync`), and MCP
  endpoint (`/mcp`).
- The Docker image published from this repository.
- Authentication and authorization (Better Auth integration, OIDC plugin,
  magic-link flow).

Out of scope:

- Issues in upstream dependencies — please report those upstream. (We're happy
  to coordinate if the fix needs work on our side as well.)
- DoS via unrealistic load against a self-hosted instance.
- Findings that require physical access to a user's device, or social
  engineering of pert.li users / maintainers.
- Self-hosted misconfiguration (e.g., running without TLS, exposing the
  database to the public internet). The [self-hosting
  guide](./SELF_HOSTING.md) documents the expected deployment shape.

## Hardening notes for self-hosted deployments

- Set `BETTER_AUTH_SECRET` to a fresh value (generate with
  `pnpm dlx @better-auth/cli secret`). Never reuse the value from another
  deployment.
- Put pert.li behind TLS. The cookies Better Auth issues are marked `Secure`
  in production; serving over plain HTTP will break sign-in.
- Restrict the Postgres instance to the app's network — do not expose it
  publicly. Back up regularly (`pg_dump` or PVC snapshot if you're on the
  PGLite-on-PVC topology).
- Rotate any LLM API keys and OIDC client secrets on a schedule appropriate to
  your environment.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, magicLink } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";
import { account, session, user, verification } from "#/db/schema";
import {
	type OidcPublicInfo,
	parseOidcConfig,
	toPublicInfo,
} from "#/lib/auth-oidc";
import { createEmailTransport } from "#/lib/email.server";

// Drizzle adapter works for both production Neon and the e2e PGLite
// backend; the db proxy in src/db/index.ts routes to whichever driver
// is configured. One auth code path = no test/prod drift.
const authDatabase = drizzleAdapter(db, {
	provider: "pg",
	schema: { user, session, account, verification },
});

const emailTransport = createEmailTransport(process.env);
if (emailTransport.kind === "console") {
	console.warn(
		"[auth] No email transport configured (set SMTP_HOST or RESEND_API_KEY). Magic links will be logged to stdout instead of being sent.",
	);
}

// Optional: a single OIDC provider for on-prem / Entra ID deployments. When
// the OIDC_* env vars aren't set the plugin isn't loaded at all, so the
// signin page just shows email+password and magic link.
const oidcConfig = parseOidcConfig(process.env);
const oidcPlugins = oidcConfig
	? [
			genericOAuth({
				config: [
					{
						providerId: oidcConfig.providerId,
						clientId: oidcConfig.clientId,
						clientSecret: oidcConfig.clientSecret,
						discoveryUrl: oidcConfig.discoveryUrl,
						scopes: oidcConfig.scopes,
					},
				],
			}),
		]
	: [];

/** Browser-safe view of the OIDC config (no secrets). null when unset. */
export function getOidcPublicInfo(): OidcPublicInfo | null {
	return oidcConfig ? toPublicInfo(oidcConfig) : null;
}

// Vite's environment runner sandboxes process.env so better-auth's auto-
// detect of BETTER_AUTH_URL / origin can miss values the outer process saw.
// Pass baseURL + trustedOrigins through explicitly so the CSRF check works
// against any deployment URL (custom domain, on-prem, e2e test port).
const baseURL = process.env.BETTER_AUTH_URL;
const trustedOrigins = [
	process.env.BETTER_AUTH_URL,
	process.env.E2E_PGLITE === "1"
		? `http://localhost:${process.env.PORT ?? "3100"}`
		: undefined,
].filter((u): u is string => typeof u === "string" && u.length > 0);

export const auth = betterAuth({
	database: authDatabase,
	baseURL,
	trustedOrigins,
	emailAndPassword: {
		enabled: true,
	},
	plugins: [
		magicLink({
			sendMagicLink: async ({ email, url }) => {
				if (emailTransport.kind === "console") {
					// Preserve the prior dev-fallback log format so anything (tests,
					// docs, screencasts) that grepped for "[magic-link]" still works.
					console.log(`[magic-link] ${email} → ${url}`);
				}
				await emailTransport.send({
					to: email,
					subject: "Your sign-in link for pert.li",
					text: `Click to sign in to pert.li:\n\n${url}\n\nThe link expires in 5 minutes. If you didn't request it, you can ignore this email.`,
				});
			},
		}),
		...oidcPlugins,
		tanstackStartCookies(),
	],
});

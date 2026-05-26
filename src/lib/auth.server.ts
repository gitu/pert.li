import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, magicLink } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Resend } from "resend";
import { db } from "#/db";
import { account, session, user, verification } from "#/db/schema";
import {
	type OidcPublicInfo,
	parseOidcConfig,
	toPublicInfo,
} from "#/lib/auth-oidc";

// Drizzle adapter works for both production Neon and the e2e PGLite
// backend; the db proxy in src/db/index.ts routes to whichever driver
// is configured. One auth code path = no test/prod drift.
const authDatabase = drizzleAdapter(db, {
	provider: "pg",
	schema: { user, session, account, verification },
});

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@pert.li";
// Soft check: warn if the sender isn't on the verified @pert.li domain, but
// don't crash the server. Cloud Run can run with Resend's sandbox sender
// (`onboarding@resend.dev`) until the production DNS is in place, and dev
// environments often default to it too. A hard throw blocked boot for
// everyone the moment the domain wasn't yet verified.
if (!/@pert\.li$/i.test(FROM_EMAIL)) {
	console.warn(
		`[auth] RESEND_FROM_EMAIL is "${FROM_EMAIL}". For production set this to a verified @pert.li sender; the sandbox address only delivers to the Resend account owner.`,
	);
}
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

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
// In non-production, accept any loopback origin so `pnpm dev` works on
// whichever port Vite happened to grab (3000, 3500, a worktree port, …)
// without making the contributor set BETTER_AUTH_URL by hand. Production
// still requires BETTER_AUTH_URL — these wildcards aren't added there.
const isDev = process.env.NODE_ENV !== "production";
const trustedOrigins = [
	process.env.BETTER_AUTH_URL,
	...(isDev
		? ["http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"]
		: []),
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
				if (!resend) {
					// Local dev without Resend: log the link so sign-in still works
					// instead of silently swallowing it. Prod MUST set RESEND_API_KEY.
					console.log(`[magic-link] (no RESEND_API_KEY) ${email} → ${url}`);
					return;
				}
				const { error } = await resend.emails.send({
					from: FROM_EMAIL,
					to: email,
					subject: "Your sign-in link for pert.li",
					text: `Click to sign in to pert.li:\n\n${url}\n\nThe link expires in 5 minutes. If you didn't request it, you can ignore this email.`,
				});
				if (error) {
					throw new Error(
						`Resend send failed: ${error.message ?? JSON.stringify(error)}`,
					);
				}
			},
		}),
		...oidcPlugins,
		tanstackStartCookies(),
	],
});

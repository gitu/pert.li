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

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@pert.li";
if (!/@pert\.li$/i.test(FROM_EMAIL)) {
	throw new Error(
		`RESEND_FROM_EMAIL must be a @pert.li address (got "${FROM_EMAIL}")`,
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

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: { user, session, account, verification },
	}),
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

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Resend } from "resend";
import { db } from "#/db";
import { account, session, user, verification } from "#/db/schema";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// `onboarding@resend.dev` is Resend's shared sender — works without a
// verified domain but only delivers to the API key's own account email.
// Production should set RESEND_FROM_EMAIL to a verified-domain address.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

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
		tanstackStartCookies(),
	],
});

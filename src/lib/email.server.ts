// Email transport selection for magic-link sign-in.
//
// Priority order:
//   1. SMTP_HOST set       → nodemailer over SMTP (on-prem-friendly)
//   2. RESEND_API_KEY set  → Resend (the original cloud-hosted path)
//   3. neither             → dev fallback: log the link to the console
//
// Picking SMTP first means an operator can override the bundled Resend wiring
// without having to unset RESEND_API_KEY in every environment that already
// inherits it.

import type { Resend } from "resend";

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
}

export interface EmailTransport {
	readonly kind: "smtp" | "resend" | "console";
	send(message: EmailMessage): Promise<void>;
}

interface SmtpConfig {
	host: string;
	port: number;
	// `secure: true` → TLS from the start (typically port 465).
	// `secure: false` → plaintext that upgrades via STARTTLS if the server
	// offers it (typically ports 587 / 25). Defaults to true on 465, false
	// elsewhere — same heuristic nodemailer itself uses.
	secure: boolean;
	auth?: { user: string; pass: string };
	from: string;
}

function parseSmtpConfig(
	env: NodeJS.ProcessEnv,
	defaultFrom: string,
): SmtpConfig | null {
	const host = env.SMTP_HOST?.trim();
	if (!host) return null;
	const port = env.SMTP_PORT ? Number.parseInt(env.SMTP_PORT, 10) : 587;
	if (!Number.isFinite(port) || port <= 0 || port > 65535) {
		throw new Error(
			`[email] SMTP_PORT must be a valid TCP port; got "${env.SMTP_PORT}"`,
		);
	}
	const secure = env.SMTP_SECURE
		? env.SMTP_SECURE === "1" || env.SMTP_SECURE === "true"
		: port === 465;
	const user = env.SMTP_USER?.trim();
	const pass = env.SMTP_PASS;
	const auth = user && pass ? { user, pass } : undefined;
	const from = env.SMTP_FROM?.trim() || defaultFrom;
	return { host, port, secure, auth, from };
}

function makeSmtpTransport(config: SmtpConfig): EmailTransport {
	// Lazy-load nodemailer so a Resend-only or dev-console deployment never
	// pays its cold-start cost.
	let transporterPromise: Promise<import("nodemailer").Transporter> | undefined;
	const getTransporter = async () => {
		if (!transporterPromise) {
			transporterPromise = import("nodemailer").then((mod) =>
				mod.createTransport({
					host: config.host,
					port: config.port,
					secure: config.secure,
					auth: config.auth,
				}),
			);
		}
		return transporterPromise;
	};
	return {
		kind: "smtp",
		send: async ({ to, subject, text }) => {
			const transporter = await getTransporter();
			await transporter.sendMail({ from: config.from, to, subject, text });
		},
	};
}

function makeResendTransport(apiKey: string, from: string): EmailTransport {
	let clientPromise: Promise<Resend> | undefined;
	const getClient = async () => {
		if (!clientPromise) {
			clientPromise = import("resend").then((mod) => new mod.Resend(apiKey));
		}
		return clientPromise;
	};
	return {
		kind: "resend",
		send: async ({ to, subject, text }) => {
			const client = await getClient();
			const { error } = await client.emails.send({ from, to, subject, text });
			if (error) {
				throw new Error(
					`Resend send failed: ${error.message ?? JSON.stringify(error)}`,
				);
			}
		},
	};
}

function makeConsoleTransport(): EmailTransport {
	return {
		kind: "console",
		send: async ({ to, text }) => {
			console.log(`[email] (no transport configured) → ${to}\n${text}`);
		},
	};
}

export function createEmailTransport(
	env: NodeJS.ProcessEnv = process.env,
): EmailTransport {
	// Same default sender the legacy Resend code used; SMTP_FROM / RESEND_FROM_EMAIL
	// can override on either branch.
	const defaultFrom = env.RESEND_FROM_EMAIL ?? "noreply@pert.li";
	const smtp = parseSmtpConfig(env, defaultFrom);
	if (smtp) return makeSmtpTransport(smtp);
	const resendKey = env.RESEND_API_KEY;
	if (resendKey) return makeResendTransport(resendKey, defaultFrom);
	return makeConsoleTransport();
}

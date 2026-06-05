import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { MarketingFooter } from "#/components/marketing/marketing-footer";
import { MarketingHeader } from "#/components/marketing/marketing-header";
import { useAppConfig } from "#/lib/app-config";
import { getAppConfig } from "#/server/config";

export const Route = createFileRoute("/privacy")({
	loader: async () => {
		const { privacy } = await getAppConfig();
		// On-prem / white-label deployments point this at their own policy URL.
		// We throw a redirect from the loader so the route never renders our
		// default copy when an override is configured.
		if (privacy.mode === "external" && privacy.externalUrl) {
			throw redirect({ href: privacy.externalUrl, reloadDocument: true });
		}
		// Operators can drop the privacy policy entirely; the route then has no
		// page to render, so it 404s like any other unknown path.
		if (privacy.mode === "disabled") {
			throw notFound();
		}
		return null;
	},
	component: PrivacyPage,
});

function PrivacyPage() {
	const { appName } = useAppConfig();
	return (
		<div className="flex min-h-svh flex-col bg-background">
			<MarketingHeader width="reading" />

			<main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-12">
				<article className="prose prose-zinc dark:prose-invert max-w-none">
					<h1 className="text-3xl font-semibold tracking-tight">
						Privacy policy
					</h1>
					<p className="text-sm text-muted-foreground">
						Default policy for the hosted {appName} deployment. On-prem
						deployments may publish their own at a URL configured by the
						operator.
					</p>

					<h2 className="mt-10 text-xl font-semibold tracking-tight">
						No tracking
					</h2>
					<p>
						{appName} runs no analytics, no advertising pixels, no third-party
						trackers, and no fingerprinting. There is no Google Analytics, no
						Segment, no Sentry session replay, no Meta Pixel, no Hotjar — no
						telemetry of any kind on your browsing.
					</p>

					<h2 className="mt-8 text-xl font-semibold tracking-tight">Cookies</h2>
					<p>
						Every cookie {appName} stores is strictly necessary for the app to
						function. There are no optional or marketing cookies, so there is
						nothing to "consent" to — the cookie hint at the bottom of the
						screen is informational, not a consent gate.
					</p>
					<ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm">
						<li>
							<strong>Session cookie</strong> — issued by Better Auth when you
							sign in. Without it the server can't tell that you're you. Cleared
							when you sign out.
						</li>
						<li>
							<strong>OAuth state cookie</strong> — short-lived, only set during
							a single-sign-on round trip; used to prevent CSRF on the OAuth
							callback. Deleted as soon as the callback completes.
						</li>
					</ul>
					<p className="mt-3">
						We also persist UI state in <code>localStorage</code>, which never
						leaves your browser on its own: your theme choice, whether the
						welcome page has been seen, chat dock layout, canvas view
						preferences, which task containers are collapsed, your task list's
						visible columns and edit profiles, and whether you've dismissed this
						cookie hint. Recent chat messages are also cached locally so the
						conversation survives a reload — that cache is not pushed to our
						server, though any message you submit to the assistant is sent to
						the configured LLM provider as described below. You can clear all of
						these at any time from your browser's site-data UI.
					</p>

					<h2 className="mt-8 text-xl font-semibold tracking-tight">
						What we store about you
					</h2>
					<ul className="mt-2 list-disc space-y-1.5 pl-6 text-sm">
						<li>
							Your account: email, display name, optional avatar URL, the hashed
							password (only if you set one).
						</li>
						<li>
							Projects, tasks, dependencies, and history you create — including
							any content you share with collaborators.
						</li>
						<li>Audit logs of significant workspace actions.</li>
					</ul>

					<h2 className="mt-8 text-xl font-semibold tracking-tight">
						Third-party processors
					</h2>
					<p>
						The default hosted deployment talks to these external services on
						your behalf. Self-hosted deployments may use none, some, or
						different ones.
					</p>
					<ul className="mt-2 list-disc space-y-1.5 pl-6 text-sm">
						<li>
							<strong>Neon</strong> — Postgres hosting for the account and
							project database.
						</li>
						<li>
							<strong>Resend</strong> — sends the magic-link sign-in email when
							you choose passwordless sign-in.
						</li>
						<li>
							<strong>Anthropic / OpenAI / Google</strong> — the in-app AI
							assistant forwards your chat messages and the projects you ask it
							to read to whichever LLM provider the deployment has configured.
							The provider's own privacy policy applies to those messages.
						</li>
					</ul>

					<h2 className="mt-8 text-xl font-semibold tracking-tight">
						Your data
					</h2>
					<p>
						You can delete projects from the app and your entire account by
						contacting the deployment operator. Deletion removes the data from
						the live database; backups roll off on their normal retention cycle.
					</p>

					<h2 className="mt-8 text-xl font-semibold tracking-tight">Changes</h2>
					<p>
						If this policy changes materially we'll surface a notice next to the
						cookie hint. The git history of this file is the canonical change
						log.
					</p>
				</article>
			</main>
			<MarketingFooter width="reading" />
		</div>
	);
}

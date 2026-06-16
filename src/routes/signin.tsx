import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { VersionFooter } from "#/components/legal/version-footer";
import { BrandMark } from "#/components/marketing/brand-mark";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useAppConfig } from "#/lib/app-config";
import { authClient } from "#/lib/auth-client";
import { getOidcButton } from "#/server/oidc";

// Same-origin relative path only — reject `//evil.com`, full URLs, or any
// other scheme to keep this from being abused as an open-redirect.
const callbackUrlSchema = z
	.string()
	.regex(/^\/(?!\/)/, "Must be a relative path starting with /")
	.max(2048)
	.optional()
	.catch(undefined);

const signinSearchSchema = z.object({
	callbackURL: callbackUrlSchema,
	// `?local=1` opts out of SSO auto-forward and shows the email/password form.
	// The escape hatch for the bootstrap admin on an on-prem deployment whose
	// users otherwise go straight to the IdP.
	local: z.coerce.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/signin")({
	component: SignInPage,
	loader: () => getOidcButton(),
	validateSearch: signinSearchSchema,
});

// Shared chrome around whichever card state is showing: the brand-tinted
// backdrop, the wordmark, the footer links, and the build version. Keeping it
// in one place means the signed-in offer and the SSO-redirect screen get the
// same frame as the form without duplicating markup.
function SignInShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative grid min-h-svh place-items-center overflow-hidden bg-background p-6">
			{/* Subtle brand wash behind the card — echoes the muted-teal accent the
			    marketing pages use, without competing with the form. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-brand/[0.07] via-background to-background"
			/>
			<div className="flex w-full max-w-sm flex-col items-stretch gap-6">
				<BrandMark className="justify-center" />
				{children}
				<FooterLinks />
				<VersionFooter />
			</div>
		</div>
	);
}

function FooterLinks() {
	const { privacy } = useAppConfig();
	return (
		<div className="flex items-center justify-center gap-3 text-center text-xs text-muted-foreground">
			<Link to="/" className="text-muted-foreground hover:text-foreground">
				← back to home
			</Link>
			<span aria-hidden>·</span>
			<Link to="/about" className="text-muted-foreground hover:text-foreground">
				About
			</Link>
			<span aria-hidden>·</span>
			<Link
				to="/methodology"
				className="text-muted-foreground hover:text-foreground"
			>
				How it works
			</Link>
			{privacy.mode !== "disabled" && (
				<>
					<span aria-hidden>·</span>
					<Link
						to="/privacy"
						className="text-muted-foreground hover:text-foreground"
					>
						Privacy
					</Link>
				</>
			)}
		</div>
	);
}

const CARD_CLASS =
	"w-full rounded-xl border bg-card p-6 shadow-lg shadow-brand/5";

function SignInPage() {
	const navigate = useNavigate();
	const { appName } = useAppConfig();
	const oidcButton = Route.useLoaderData();
	const { callbackURL, local } = Route.useSearch();
	const callback = callbackURL ?? "/";
	const bypassSso = local ?? false;
	// Live session check (not the offline cache): we only offer the "jump to
	// your projects" shortcut when there's a genuinely valid auth.
	const { data: sessionData, isPending: sessionPending } =
		authClient.useSession();
	const sessionUser = sessionData?.user ?? null;
	// Lets a signed-in visitor fall through from the shortcut to the normal form
	// ("use a different account").
	const [showForm, setShowForm] = useState(false);
	const [mode, setMode] = useState<"signin" | "signup" | "link">("signin");
	// Hydration marker the e2e tests wait on before clicking. The page is
	// SSR'd; without this guard, Playwright's first click() lands on the
	// pre-hydration DOM and the button's onClick is a no-op (setMode never
	// runs, the heading stays "Sign in", and the assertion times out).
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		setHydrated(true);
	}, []);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [oauthPending, setOauthPending] = useState(false);

	async function startOauth() {
		if (!oidcButton) return;
		setError(null);
		setInfo(null);
		setOauthPending(true);
		try {
			// better-auth redirects the browser to the IdP; the promise only
			// settles on error. We don't clear oauthPending on success because the
			// page is about to navigate away.
			await authClient.signIn.oauth2({
				providerId: oidcButton.providerId,
				callbackURL: callback,
			});
		} catch (err) {
			setOauthPending(false);
			setError(err instanceof Error ? err.message : "OAuth sign-in failed");
		}
	}

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setInfo(null);
		setPending(true);
		try {
			if (mode === "link") {
				const result = await authClient.signIn.magicLink({
					email,
					callbackURL: callback,
				});
				if (result.error) {
					setError(result.error.message ?? "Could not send sign-in link");
					return;
				}
				setInfo(`Check ${email} for a sign-in link.`);
				return;
			}
			const result =
				mode === "signin"
					? await authClient.signIn.email({ email, password })
					: await authClient.signUp.email({ name, email, password });
			if (result.error) {
				setError(result.error.message ?? "Something went wrong");
				return;
			}
			// Email/password flows don't bounce through an IdP, so we have to
			// honor `callbackURL` ourselves. The path was validated to be
			// same-origin relative by the route's search schema.
			navigate({ href: callback });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unexpected error");
		} finally {
			setPending(false);
		}
	}

	// Which of the three card states to render. A valid live session wins (offer
	// the shortcut, never bounce a logged-in user to the IdP); otherwise an
	// auto-redirect deployment forwards to SSO unless `?local=1` opts out.
	const showSignedInOffer = Boolean(sessionUser) && !showForm;
	const showSsoRedirect =
		!showSignedInOffer && Boolean(oidcButton?.autoRedirect) && !bypassSso;

	// Fire the SSO redirect once, but only after the session check has resolved
	// to "no user" — so a still-valid session is offered the shortcut instead of
	// being thrown at the IdP.
	const autoRedirectFiredRef = useRef(false);
	// startOauth is omitted from the deps on purpose: the ref guard makes this a
	// once-only fire, and re-running on the function's identity would risk a
	// double redirect.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional once-only fire
	useEffect(() => {
		if (showSsoRedirect && !sessionPending && !autoRedirectFiredRef.current) {
			autoRedirectFiredRef.current = true;
			void startOauth();
		}
	}, [showSsoRedirect, sessionPending]);

	if (showSignedInOffer && sessionUser) {
		return (
			<SignInShell>
				<div className="w-full space-y-5 rounded-xl border bg-card p-6 shadow-lg shadow-brand/5">
					<div className="space-y-1">
						<h1 className="text-xl font-semibold tracking-tight">
							You're already signed in
						</h1>
						<p className="text-sm text-muted-foreground">
							Signed in to {appName} as{" "}
							<span className="font-medium text-foreground">
								{sessionUser.email}
							</span>
							.
						</p>
					</div>
					<Button
						className="w-full"
						onClick={() => navigate({ href: callback })}
					>
						Continue to your projects
						<ArrowRightIcon className="size-4" />
					</Button>
					<div className="text-center text-sm text-muted-foreground">
						<button
							type="button"
							onClick={() => setShowForm(true)}
							className="text-foreground underline-offset-4 hover:underline"
						>
							Use a different account
						</button>
					</div>
				</div>
			</SignInShell>
		);
	}

	if (showSsoRedirect) {
		return (
			<SignInShell>
				<div className={`${CARD_CLASS} space-y-5 text-center`}>
					<div className="flex flex-col items-center gap-3">
						<Loader2Icon className="size-6 animate-spin text-brand" />
						<div className="space-y-1">
							<h1 className="text-xl font-semibold tracking-tight">
								Taking you to {oidcButton?.displayName}…
							</h1>
							<p className="text-sm text-muted-foreground">
								Redirecting to your identity provider to sign in.
							</p>
						</div>
					</div>
					<Link
						to="/signin"
						search={{ callbackURL, local: true }}
						className="inline-block text-sm text-foreground underline-offset-4 hover:underline"
					>
						Sign in another way →
					</Link>
				</div>
			</SignInShell>
		);
	}

	return (
		<SignInShell>
			<form
				onSubmit={onSubmit}
				className={`${CARD_CLASS} space-y-5`}
				data-hydrated={hydrated || undefined}
			>
				<div className="space-y-1">
					<h1 className="text-xl font-semibold tracking-tight">
						{mode === "signin"
							? "Sign in"
							: mode === "signup"
								? "Create an account"
								: "Email me a sign-in link"}
					</h1>
					<p className="text-sm text-muted-foreground">
						{mode === "signin"
							? `Welcome back to ${appName}.`
							: mode === "signup"
								? "Pick a name and an email to get started. Prefer not to set a password? Use a sign-in link instead."
								: "We'll email a one-time link. Works for new accounts too — no password ever required."}
					</p>
				</div>

				{oidcButton && mode !== "link" && (
					<>
						<Button
							type="button"
							variant="outline"
							className="w-full"
							onClick={startOauth}
							disabled={oauthPending || pending}
						>
							{oauthPending
								? "Redirecting…"
								: `Continue with ${oidcButton.displayName}`}
						</Button>
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<span className="h-px flex-1 bg-border" />
							or
							<span className="h-px flex-1 bg-border" />
						</div>
					</>
				)}

				{mode === "signup" && (
					<div className="space-y-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							autoComplete="name"
						/>
					</div>
				)}

				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						autoComplete="email"
					/>
				</div>

				{mode !== "link" && (
					<div className="space-y-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={8}
							autoComplete={
								mode === "signin" ? "current-password" : "new-password"
							}
						/>
					</div>
				)}

				{error && <p className="text-sm text-destructive">{error}</p>}
				{info && <p className="text-sm text-muted-foreground">{info}</p>}

				<Button type="submit" disabled={pending} className="w-full">
					{pending
						? "Working…"
						: mode === "signin"
							? "Sign in"
							: mode === "signup"
								? "Create account"
								: "Send sign-in link"}
				</Button>

				<div className="space-y-2 text-center text-sm text-muted-foreground">
					{mode === "link" ? (
						<button
							type="button"
							onClick={() => {
								setMode("signin");
								setInfo(null);
								setError(null);
							}}
							className="text-foreground underline-offset-4 hover:underline"
						>
							← back to password sign-in
						</button>
					) : (
						<>
							<div>
								{mode === "signin" ? (
									<>
										No account?{" "}
										<button
											type="button"
											onClick={() => setMode("signup")}
											className="text-foreground underline-offset-4 hover:underline"
										>
											Sign up
										</button>
									</>
								) : (
									<>
										Already have one?{" "}
										<button
											type="button"
											onClick={() => setMode("signin")}
											className="text-foreground underline-offset-4 hover:underline"
										>
											Sign in
										</button>
									</>
								)}
							</div>
							<div>
								<button
									type="button"
									onClick={() => {
										setMode("link");
										setInfo(null);
										setError(null);
									}}
									className="text-foreground underline-offset-4 hover:underline"
								>
									{mode === "signup"
										? "Skip the password — email me a sign-in link"
										: "Email me a sign-in link instead"}
								</button>
							</div>
						</>
					)}
				</div>
			</form>
		</SignInShell>
	);
}

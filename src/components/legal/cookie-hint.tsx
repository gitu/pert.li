import { Link } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { useAppConfig } from "#/lib/app-config";

const STORAGE_KEY = "pertli.cookieHintDismissed.v1";

// Functional-only cookies, no tracking — so this is informational, not a
// GDPR consent gate. We render a slim banner on first visit and remember the
// dismissal in localStorage so returning users don't see it again.
function readDismissed(): boolean {
	if (typeof window === "undefined") return true;
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function writeDismissed(): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, "1");
	} catch {
		// Private browsing or storage disabled — fine to lose the dismissal;
		// the banner will reappear next visit but it's not blocking.
	}
}

export function CookieHint() {
	const { appName, privacy } = useAppConfig();
	// Start hidden so we don't paint a banner during SSR and then have it
	// flash away on hydration. The effect flips it on once we've read storage.
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!readDismissed()) setVisible(true);
	}, []);

	if (!visible) return null;

	return (
		<section
			aria-label="Cookie notice"
			className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 sm:px-4 sm:pb-4"
		>
			<div className="flex w-full max-w-3xl items-start gap-3 rounded-lg border bg-card/95 p-3 text-sm shadow-lg backdrop-blur sm:items-center sm:p-4">
				<p className="flex-1 text-muted-foreground">
					{appName} only stores cookies that are required for the app to work
					(your sign-in session). No analytics, no tracking, no ads.
					{/* When the operator drops the privacy policy entirely there's no
					    page to link to, so we keep the informational notice but omit
					    the link. */}
					{privacy.mode !== "disabled" && (
						<>
							{" "}
							<Link
								to="/privacy"
								className="text-foreground underline-offset-4 hover:underline"
							>
								Read the privacy policy
							</Link>
							.
						</>
					)}
				</p>
				<Button
					type="button"
					size="sm"
					onClick={() => {
						writeDismissed();
						setVisible(false);
					}}
					data-testid="cookie-hint-dismiss"
				>
					Got it
				</Button>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					aria-label="Dismiss cookie notice"
					className="size-7 shrink-0 sm:hidden"
					onClick={() => {
						writeDismissed();
						setVisible(false);
					}}
				>
					<XIcon className="size-4" />
				</Button>
			</div>
		</section>
	);
}

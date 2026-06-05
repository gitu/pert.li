import { Link } from "@tanstack/react-router";
import { VersionFooter } from "#/components/legal/version-footer";
import { useAppConfig } from "#/lib/app-config";
import { cn } from "#/lib/utils";

const WIDTHS = {
	wide: "max-w-6xl",
	reading: "max-w-3xl",
} as const;

const REPO_URL = "https://github.com/gitu/pert.li";

const LINK = "text-muted-foreground transition-colors hover:text-foreground";

// Shared footer for the public pages — one neutral link row plus the build
// version, replacing the three slightly different per-page footers.
export function MarketingFooter({
	width = "wide",
}: {
	width?: keyof typeof WIDTHS;
}) {
	const { appName, privacy } = useAppConfig();
	return (
		<footer className="mt-24 border-t border-border">
			<div
				className={cn(
					"mx-auto flex flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between",
					WIDTHS[width],
				)}
			>
				<div className="text-xs text-muted-foreground">
					{appName} — collaborative PERT planning.
				</div>
				<nav className="flex items-center gap-5 text-xs">
					<Link to="/about" className={LINK}>
						About
					</Link>
					{privacy.mode !== "disabled" && (
						<Link to="/privacy" className={LINK}>
							Privacy
						</Link>
					)}
					<a href={REPO_URL} target="_blank" rel="noreferrer" className={LINK}>
						GitHub
					</a>
					<Link to="/signin" className={LINK}>
						Sign in
					</Link>
				</nav>
			</div>
			<div className={cn("mx-auto px-6 pb-8", WIDTHS[width])}>
				<VersionFooter className="text-xs text-muted-foreground/70 tabular-nums" />
			</div>
		</footer>
	);
}

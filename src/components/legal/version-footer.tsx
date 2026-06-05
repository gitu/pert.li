// Surfaces the running build's version (from `git describe`) on public pages
// so bug reports can include it without needing a logged-in account. The
// string is baked at build time via `import.meta.env.VITE_APP_VERSION`; see
// scripts/compute-version.mjs and vite.config.ts.

import { useAppConfig } from "#/lib/app-config";

const VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.0-dev";

type Props = {
	className?: string;
};

export function VersionFooter({ className }: Props) {
	const { appName } = useAppConfig();
	return (
		<p
			className={
				className ?? "text-center text-xs text-muted-foreground/70 tabular-nums"
			}
		>
			{appName} <span data-testid="app-version">{VERSION}</span>
		</p>
	);
}

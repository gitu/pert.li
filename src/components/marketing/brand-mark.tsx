import { Link } from "@tanstack/react-router";
import { LayersIcon } from "lucide-react";
import { useAppConfig } from "#/lib/app-config";
import { cn } from "#/lib/utils";

// The pert.li wordmark + logo tile, shared by the marketing header, footer,
// and the sign-in card so the brand reads identically everywhere. The tile
// carries the single brand accent (muted teal); everything around it stays
// neutral. `appName` is white-label aware via useAppConfig().
export function BrandMark({
	className,
	asLink = true,
}: {
	className?: string;
	asLink?: boolean;
}) {
	const { appName } = useAppConfig();
	const inner = (
		<>
			<div className="grid size-8 place-items-center rounded-md bg-brand text-brand-foreground">
				<LayersIcon className="size-4" />
			</div>
			<span className="text-base font-semibold tracking-tight text-foreground">
				{appName}
			</span>
		</>
	);

	if (!asLink) {
		return (
			<div className={cn("flex items-center gap-2", className)}>{inner}</div>
		);
	}

	return (
		<Link to="/" className={cn("flex items-center gap-2", className)}>
			{inner}
		</Link>
	);
}

import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { markWelcomeSeen } from "#/lib/welcome";
import { BrandMark } from "./brand-mark";

const WIDTHS = {
	// Wide marketing stage (landing); reading measure (about / privacy prose).
	wide: "max-w-6xl",
	reading: "max-w-3xl",
} as const;

// Shared top bar for the public pages. Previously each page hand-rolled its
// own header at a different width with slightly different actions; this gives
// them one consistent chrome. The content width adapts via `width`.
export function MarketingHeader({
	width = "wide",
}: {
	width?: keyof typeof WIDTHS;
}) {
	return (
		<header className="border-b border-border/60">
			<div
				className={cn(
					"mx-auto flex items-center justify-between px-6 py-4",
					WIDTHS[width],
				)}
			>
				<BrandMark />
				<div className="flex items-center gap-1.5">
					<Button asChild variant="ghost" size="sm">
						<Link
							to="/signin"
							onClick={() => markWelcomeSeen()}
							className="text-muted-foreground hover:text-foreground"
						>
							Sign in
						</Link>
					</Button>
					<Button asChild size="sm">
						<Link to="/signin" onClick={() => markWelcomeSeen()}>
							Get started
							<ArrowRightIcon className="size-4" />
						</Link>
					</Button>
				</div>
			</div>
		</header>
	);
}

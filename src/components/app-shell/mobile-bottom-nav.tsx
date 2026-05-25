import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { GridIcon, ListIcon, NetworkIcon, TimerIcon } from "lucide-react";
import { cn } from "#/lib/utils";
import type { ProjectView } from "#/routes/_app/p.$projectId";

// Mobile bottom navigation — the phone-shell equivalent of the four
// Network / Timeline / Table / Matrix view tabs in the project header.
// Only renders when the active route is a project (no view tabs make sense
// on the workspace home). Mirrors the desktop ViewTab logic: writing
// `view=network` is encoded as the absence of the search param.

const VIEW_TABS: Array<{
	id: ProjectView;
	label: string;
	Icon: typeof NetworkIcon;
}> = [
	{ id: "network", label: "Network", Icon: NetworkIcon },
	{ id: "timeline", label: "Timeline", Icon: TimerIcon },
	{ id: "table", label: "Table", Icon: ListIcon },
	{ id: "matrix", label: "Matrix", Icon: GridIcon },
];

export function MobileBottomNav() {
	const params = useParams({ strict: false }) as { projectId?: string };
	const search = useSearch({ strict: false }) as { view?: ProjectView };
	const navigate = useNavigate();
	const projectId = params.projectId;
	if (!projectId) return null;

	const active: ProjectView = search.view ?? "network";

	return (
		<nav
			aria-label="Project view"
			className="flex h-14 shrink-0 items-stretch border-t bg-card"
			data-testid="mobile-bottom-nav"
		>
			{VIEW_TABS.map((tab) => {
				const isActive = active === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={isActive}
						data-testid={`mobile-view-tab-${tab.id}`}
						onClick={() =>
							navigate({
								to: "/p/$projectId",
								params: { projectId },
								search: { view: tab.id === "network" ? undefined : tab.id },
								replace: true,
							})
						}
						className={cn(
							"flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
							isActive
								? "text-foreground"
								: "text-muted-foreground active:text-foreground",
						)}
					>
						<tab.Icon className="size-5" />
						{tab.label}
					</button>
				);
			})}
		</nav>
	);
}

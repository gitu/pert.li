import { Link } from "@tanstack/react-router";
import {
	ArrowLeftIcon,
	GitBranchIcon,
	GitCompareIcon,
	MessageSquareIcon,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

// Slim banner that sits above the canvas when the current project is a
// branch. Three jobs:
//   1. tell the user *this* is a branch (and which plan it came from),
//   2. quantify drift since the fork ("12 changes since branched"),
//   3. expose Compare-and-merge + Comments actions inline so they don't have
//      to dig into menus.

export type BranchBannerProps = {
	parent: { id: string; title: string };
	branchTitle: string;
	description?: string | null;
	changeCount: number;
	commentCount?: number;
	onOpenMerge: () => void;
	onOpenComments: () => void;
	className?: string;
};

export function BranchBanner({
	parent,
	branchTitle,
	description,
	changeCount,
	commentCount,
	onOpenMerge,
	onOpenComments,
	className,
}: BranchBannerProps) {
	return (
		<div
			data-testid="branch-banner"
			className={cn(
				"flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-primary/5 px-3 py-1.5 text-xs",
				className,
			)}
		>
			<GitBranchIcon className="size-3.5 shrink-0 text-primary" />
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="text-[10px] uppercase tracking-wide text-primary">
						Branch
					</span>
					<span className="text-muted-foreground">of</span>
					<Link
						to="/p/$projectId"
						params={{ projectId: parent.id }}
						className="flex min-w-0 items-center gap-1 truncate font-medium text-foreground hover:underline"
						data-testid="branch-banner-parent-link"
					>
						<ArrowLeftIcon className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{parent.title}</span>
					</Link>
					<span aria-hidden className="text-muted-foreground">
						·
					</span>
					<span className="truncate text-muted-foreground">
						<strong className="font-medium text-foreground">
							{branchTitle}
						</strong>
					</span>
					<span aria-hidden className="text-muted-foreground">
						·
					</span>
					<span
						className="text-muted-foreground"
						data-testid="branch-change-count"
					>
						{changeCount === 0
							? "no changes since branched"
							: `${changeCount} ${changeCount === 1 ? "change" : "changes"} since branched`}
					</span>
				</div>
				{description && (
					<div
						className="truncate text-[11px] text-muted-foreground"
						title={description}
						data-testid="branch-banner-description"
					>
						{description}
					</div>
				)}
			</div>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 gap-1 px-2 text-[11px]"
					onClick={onOpenComments}
					data-testid="branch-banner-comments"
				>
					<MessageSquareIcon className="size-3" />
					Comments
					{commentCount !== undefined && commentCount > 0 && (
						<span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
							{commentCount}
						</span>
					)}
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-7 gap-1 px-2 text-[11px]"
					onClick={onOpenMerge}
					data-testid="branch-banner-merge"
				>
					<GitCompareIcon className="size-3" />
					Compare &amp; merge
				</Button>
			</div>
		</div>
	);
}

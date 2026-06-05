import { GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "#/lib/utils.ts";

// A collapse/expand affordance rendered directly on a resize divider, so the
// control lives on the bar's own edge instead of floating in a far-off toolbar.
// The button stays clickable when the panel collapses to size 0 (the separator
// stays pinned at the screen edge) and the chevron flips to point the way it
// will re-expand.
type HandleToggle = {
	collapsed: boolean;
	onToggle: () => void;
	/** aria-label — caller flips the wording with `collapsed`. */
	label: string;
	testId?: string;
	/** Shown when expanded; should point the collapse direction. */
	collapseIcon: ReactNode;
	/** Shown when collapsed; should point the expand direction. */
	expandIcon: ReactNode;
};

function ResizablePanelGroup({
	className,
	...props
}: ResizablePrimitive.GroupProps) {
	return (
		<ResizablePrimitive.Group
			data-slot="resizable-panel-group"
			className={cn(
				"flex h-full w-full aria-[orientation=vertical]:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
	return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
	withHandle,
	toggle,
	className,
	...props
}: ResizablePrimitive.SeparatorProps & {
	withHandle?: boolean;
	toggle?: HandleToggle;
}) {
	return (
		<ResizablePrimitive.Separator
			data-slot="resizable-handle"
			className={cn(
				"relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
				// A vertical divider anchors its toggle near the top and lets it
				// protrude toward the content side (left-0) so it stays fully
				// on-screen even when the panel collapses to the very edge. A
				// horizontal divider re-anchors it: centered horizontally and
				// sitting just above the line so it clears the bottom edge.
				"[&[aria-orientation=horizontal]_[data-resize-toggle]]:bottom-0 [&[aria-orientation=horizontal]_[data-resize-toggle]]:left-1/2 [&[aria-orientation=horizontal]_[data-resize-toggle]]:top-auto [&[aria-orientation=horizontal]_[data-resize-toggle]]:-translate-x-1/2",
				className,
			)}
			{...props}
		>
			{withHandle && (
				<div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border">
					<GripVerticalIcon className="size-2.5" />
				</div>
			)}
			{toggle && (
				<button
					type="button"
					data-resize-toggle=""
					data-testid={toggle.testId}
					// Stop the pointer/mouse-down from reaching the separator so a
					// click toggles the panel instead of starting a resize drag.
					onPointerDown={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
					onClick={toggle.onToggle}
					aria-label={toggle.label}
					aria-pressed={!toggle.collapsed}
					className="absolute left-0 top-3 z-20 flex size-5 items-center justify-center rounded-sm border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden [&_svg]:size-3.5"
				>
					{toggle.collapsed ? toggle.expandIcon : toggle.collapseIcon}
				</button>
			)}
		</ResizablePrimitive.Separator>
	);
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };

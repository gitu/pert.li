import { XIcon } from "lucide-react";
import { TaskInspector } from "#/components/pert/inspector/task-inspector";
import { Button } from "#/components/ui/button";

// Docked inspector rendered as a resizable panel sibling of the canvas when the
// project is in fullscreen. The regular bottom panel (Details/History tabs)
// lives outside the fullscreen element and is therefore hidden by the browser;
// this dock lives INSIDE the fullscreen element so the user can keep editing
// the selected task without leaving fullscreen — and, unlike the old floating
// overlay, it sits *beside* the canvas (right on landscape, bottom on portrait)
// so nothing is obscured and edits don't require panning around.
//
// Selection is owned by the global selectionStore; closing the dock just
// clears it — clicking another task brings the dock back.
export function FullscreenInspectorDock({ onClose }: { onClose: () => void }) {
	return (
		<div
			data-testid="fullscreen-inspector-dock"
			className="flex h-full min-h-0 flex-col overflow-hidden bg-card"
		>
			<div className="flex shrink-0 items-center justify-between border-b bg-card/40 px-3 py-1.5">
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Task details
				</div>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-7"
					onClick={onClose}
					aria-label="Close details panel"
					data-testid="fullscreen-inspector-close"
				>
					<XIcon className="size-3.5" />
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				<TaskInspector />
			</div>
		</div>
	);
}

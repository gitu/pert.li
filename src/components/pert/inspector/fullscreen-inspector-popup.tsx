import { XIcon } from "lucide-react";
import { TaskInspector } from "#/components/pert/inspector/task-inspector";
import { Button } from "#/components/ui/button";

// Floating inspector card rendered as an overlay when the project is in
// fullscreen. The regular bottom panel (Details/History tabs) sits outside
// the fullscreen element and is therefore hidden by the browser; this popup
// lives INSIDE the fullscreen element so the user can still edit the
// selected task without leaving fullscreen.
//
// Selection is owned by the global selectionStore; closing the popup just
// clears it — clicking another task brings the popup back.
export function FullscreenInspectorPopup({ onClose }: { onClose: () => void }) {
	return (
		<div
			data-testid="fullscreen-inspector-popup"
			className="pointer-events-auto absolute top-3 right-3 z-30 flex max-h-[calc(100vh-1.5rem)] w-[min(720px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
		>
			<div className="flex shrink-0 items-center justify-between border-b bg-card/60 px-3 py-1.5">
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Task details
				</div>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-7"
					onClick={onClose}
					aria-label="Close details popup"
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

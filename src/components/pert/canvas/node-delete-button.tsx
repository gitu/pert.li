import { Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "#/lib/utils";

// Two-click confirm delete affordance rendered in the top-right corner of a
// task / container card. First click arms the button (red filled, label
// switches to "Confirm"); second click within 3.5s commits. Mouse leaving
// the button or 3.5s elapsing disarms.
//
// Hidden until the parent card is hovered or selected so the chrome stays
// quiet at rest. Stops React Flow's drag / select behaviour from firing
// underneath via stopPropagation on pointer-down + click.

export type NodeDeleteButtonProps = {
	onDelete: () => void;
	// Show the button outside hover when the node is selected. Without this
	// flag the affordance becomes invisible to touch users on mobile.
	alwaysVisible?: boolean;
	testId?: string;
};

export function NodeDeleteButton({
	onDelete,
	alwaysVisible,
	testId,
}: NodeDeleteButtonProps) {
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const id = window.setTimeout(() => setArmed(false), 3500);
		return () => window.clearTimeout(id);
	}, [armed]);
	return (
		<button
			type="button"
			data-testid={testId ?? "node-delete"}
			data-armed={armed || undefined}
			// `nodrag` prevents React Flow from starting a drag on the node
			// when the user grabs the button; stopPropagation on click prevents
			// the click bubbling and re-selecting the node we're about to
			// remove.
			className={cn(
				"nodrag absolute top-1 right-1 z-20 grid size-6 place-items-center rounded-md border text-xs shadow-sm transition-opacity",
				armed
					? "border-destructive bg-destructive text-destructive-foreground"
					: "border-border bg-background/90 text-muted-foreground hover:text-destructive",
				alwaysVisible
					? "opacity-100"
					: armed
						? "opacity-100"
						: "opacity-0 group-hover:opacity-100",
			)}
			title={
				armed ? "Click again to confirm" : "Delete (click again to confirm)"
			}
			aria-label={armed ? "Confirm delete" : "Delete"}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => {
				e.stopPropagation();
				if (armed) {
					onDelete();
					setArmed(false);
				} else {
					setArmed(true);
				}
			}}
		>
			<Trash2Icon className="size-3.5" />
		</button>
	);
}

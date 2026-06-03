import { CircleDashedIcon, CloudOffIcon } from "lucide-react";
import { Button } from "#/components/ui/button";

export type CanvasLoadingProps = {
	message: string;
	// Optional secondary line — used for hints like "it will load
	// automatically when the connection is back".
	detail?: string;
	// Optional action button (e.g. Retry for an unavailable document). When
	// set, the icon switches from the pulsing loader to an offline glyph since
	// an action implies we're no longer just waiting.
	action?: {
		label: string;
		onClick: () => void;
	};
};

export function CanvasLoading({ message, detail, action }: CanvasLoadingProps) {
	return (
		<div className="grid h-full place-items-center">
			<div className="flex max-w-sm flex-col items-center gap-3 text-center text-sm text-muted-foreground">
				<div className="grid size-10 place-items-center rounded-full border">
					{action ? (
						<CloudOffIcon className="size-5" />
					) : (
						<CircleDashedIcon className="size-5 animate-pulse" />
					)}
				</div>
				<p>{message}</p>
				{detail && <p className="text-xs">{detail}</p>}
				{action && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={action.onClick}
						data-testid="canvas-loading-action"
					>
						{action.label}
					</Button>
				)}
			</div>
		</div>
	);
}

import { CircleDashedIcon } from "lucide-react";

export type CanvasLoadingProps = {
	message: string;
};

export function CanvasLoading({ message }: CanvasLoadingProps) {
	return (
		<div className="grid h-full place-items-center">
			<div className="flex max-w-sm flex-col items-center gap-3 text-center text-sm text-muted-foreground">
				<div className="grid size-10 place-items-center rounded-full border">
					<CircleDashedIcon className="size-5 animate-pulse" />
				</div>
				<p>{message}</p>
			</div>
		</div>
	);
}

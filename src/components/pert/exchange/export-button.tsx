import { DownloadIcon } from "lucide-react";
import { useCallback } from "react";
import { Button } from "#/components/ui/button";
import {
	EXCHANGE_MIME_TYPE,
	serializeExchange,
	suggestExportFilename,
} from "#/lib/pert/exchange";
import type { PertDoc } from "#/lib/pert/types";

export type ExportProjectButtonProps = {
	doc: PertDoc;
	className?: string;
	// Hook for tests / Storybook so we don't have to mock URL.createObjectURL +
	// click an anchor. When provided, replaces the actual browser-side download
	// trigger but everything before it (serialisation, filename) still runs.
	onDownload?: (file: { filename: string; contents: string }) => void;
};

export function ExportProjectButton({
	doc,
	className,
	onDownload,
}: ExportProjectButtonProps) {
	const handleClick = useCallback(() => {
		const contents = serializeExchange(doc);
		const filename = suggestExportFilename(doc.title);
		if (onDownload) {
			onDownload({ filename, contents });
			return;
		}
		const blob = new Blob([contents], { type: EXCHANGE_MIME_TYPE });
		const href = URL.createObjectURL(blob);
		try {
			const anchor = document.createElement("a");
			anchor.href = href;
			anchor.download = filename;
			anchor.rel = "noopener";
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
		} finally {
			// Spec says revoke is safe to call synchronously after the click
			// dispatch; browsers buffer the download request before this fires.
			URL.revokeObjectURL(href);
		}
	}, [doc, onDownload]);

	return (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			className={className ?? "h-8 gap-1.5 text-xs"}
			onClick={handleClick}
			data-testid="project-export"
			title="Download this project as a .pert.json file"
		>
			<DownloadIcon className="size-3.5" />
			Export
		</Button>
	);
}

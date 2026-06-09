import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

// DISPLAY-SETTINGS: presentational picker for fanning the current display
// config out to other projects. The container supplies the candidate project
// list and the async `onCopy` (which does the cross-doc Automerge writes), so
// this component stays repo-free and Storybook-drivable.

export type CopyTargetProject = { id: string; title: string; url: string };

export function CopyDisplayToProjectsDialog({
	open,
	onOpenChange,
	projects,
	onCopy,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projects: CopyTargetProject[];
	// Resolves once the writes are done (or rejects on failure). The dialog owns
	// the busy state + closes itself on success.
	onCopy: (targetUrls: string[]) => Promise<void>;
}) {
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);

	const allSelected = projects.length > 0 && selected.size === projects.length;
	const toggle = (url: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(url)) next.delete(url);
			else next.add(url);
			return next;
		});
	const toggleAll = () =>
		setSelected(allSelected ? new Set() : new Set(projects.map((p) => p.url)));

	const reset = () => {
		setSelected(new Set());
		setBusy(false);
	};

	const copy = async () => {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			await onCopy([...selected]);
			onOpenChange(false);
			reset();
		} catch {
			// The container surfaces the error toast; keep the dialog open so the
			// user can retry.
			setBusy(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) return;
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent data-testid="copy-display-dialog">
				<DialogHeader>
					<DialogTitle>Copy display settings</DialogTitle>
					<DialogDescription>
						Apply this project's display settings to the projects you pick. Each
						target's existing display settings are overwritten.
					</DialogDescription>
				</DialogHeader>

				{projects.length === 0 ? (
					<p
						className="py-6 text-center text-sm text-muted-foreground"
						data-testid="copy-display-empty"
					>
						No other projects in this workspace to copy to.
					</p>
				) : (
					<div className="space-y-2">
						<label className="flex items-center gap-2 border-b pb-2 text-sm font-medium">
							<input
								type="checkbox"
								checked={allSelected}
								data-testid="copy-display-select-all"
								onChange={toggleAll}
								className="size-3.5 rounded border"
							/>
							Select all ({projects.length})
						</label>
						<ul className="max-h-64 space-y-1 overflow-y-auto">
							{projects.map((p) => (
								<li key={p.url}>
									<label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
										<input
											type="checkbox"
											checked={selected.has(p.url)}
											data-testid={`copy-display-target-${p.id}`}
											onChange={() => toggle(p.url)}
											className="size-3.5 rounded border"
										/>
										<span className="min-w-0 flex-1 truncate">
											{p.title || "Untitled project"}
										</span>
									</label>
								</li>
							))}
						</ul>
					</div>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						data-testid="copy-display-confirm"
						disabled={busy || selected.size === 0}
						onClick={copy}
					>
						{busy
							? "Copying…"
							: `Copy to ${selected.size || 0} project${selected.size === 1 ? "" : "s"}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

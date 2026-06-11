import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { IssueLinkList } from "#/components/pert/issue-links";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { SheetFooter } from "#/components/ui/sheet";
import type { IssueTrackerFormResult } from "#/lib/pert/apply-issue-tracker";

// Project-level external issue tracker config form. Lives in its own component
// so the parent can mount/unmount it on expand — initial state is captured at
// mount ("re-seed from props" for free). The form NEVER mutates the doc; it
// only emits via onSave. Mirrors ProjectCalendarForm's shape.

const EXAMPLE_KEY = "PROJ-123";

export function IssueTrackerForm({
	initial,
	onCancel,
	onSave,
}: {
	initial: IssueTrackerFormResult;
	onCancel: () => void;
	onSave: (next: IssueTrackerFormResult) => void;
}) {
	const [urlTemplate, setUrlTemplate] = useState(initial.urlTemplate);
	const [name, setName] = useState(initial.name ?? "");

	const dirty =
		urlTemplate.trim() !== initial.urlTemplate.trim() ||
		name.trim() !== (initial.name ?? "").trim();

	const hasPlaceholder = urlTemplate.includes("{key}");
	const showPreview = urlTemplate.trim() !== "";

	return (
		<>
			<div className="space-y-5 p-4">
				<div className="space-y-1.5">
					<Label htmlFor="tracker-template">Issue URL template</Label>
					<Input
						id="tracker-template"
						data-testid="tracker-template-input"
						placeholder="https://acme.atlassian.net/browse/{key}"
						value={urlTemplate}
						onChange={(e) => setUrlTemplate(e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						Use <code className="rounded bg-muted px-1">{"{key}"}</code> where
						the issue key goes. A task's issue links then become click-through
						links. Leave empty to disable.
					</p>
					{showPreview && !hasPlaceholder && (
						<p
							className="text-xs text-amber-600 dark:text-amber-500"
							data-testid="tracker-template-warning"
						>
							Template has no <code>{"{key}"}</code> placeholder — links won't
							resolve until you add one.
						</p>
					)}
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="tracker-name">Tracker name (optional)</Label>
					<Input
						id="tracker-name"
						data-testid="tracker-name-input"
						placeholder="Jira"
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						Shown as a hint next to the issue links field.
					</p>
				</div>

				{showPreview && (
					<div
						className="space-y-1.5 rounded-md border bg-muted/20 p-3"
						data-testid="tracker-preview"
					>
						<div className="text-xs font-medium text-muted-foreground">
							Preview
						</div>
						<IssueLinkList
							issueKeys={[EXAMPLE_KEY]}
							template={urlTemplate.trim()}
						/>
					</div>
				)}
			</div>
			<SheetFooter>
				{dirty ? (
					<span
						className="mr-auto inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500"
						data-testid="tracker-dirty"
					>
						<span className="size-1.5 rounded-full bg-amber-500" />
						Unsaved changes
					</span>
				) : (
					<span
						className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"
						data-testid="tracker-clean"
					>
						<CheckIcon className="size-3.5" />
						All changes saved
					</span>
				)}
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					data-testid="tracker-save"
					onClick={() =>
						onSave({
							urlTemplate: urlTemplate.trim(),
							name: name.trim() || undefined,
						})
					}
				>
					Save
				</Button>
			</SheetFooter>
		</>
	);
}

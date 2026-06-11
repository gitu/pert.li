import type { PertDoc, ProjectIssueTracker } from "./types";

// The payload IssueTrackerForm emits via onSave.
export type IssueTrackerFormResult = {
	urlTemplate: string;
	name?: string;
};

// Merge an issue-tracker-form result back into the doc. Shared by any entry
// point that edits the project's external issue tracker. Automerge rejects
// `undefined` assignments, so we conditionally add `name` and `delete` the whole
// config when the template is cleared rather than ever assigning undefined.
export function applyIssueTracker(
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	next: IssueTrackerFormResult,
): void {
	changeDoc((d) => {
		const urlTemplate = next.urlTemplate.trim();
		if (urlTemplate === "") {
			delete d.issueTracker;
			return;
		}
		const tracker: ProjectIssueTracker = { urlTemplate };
		const name = next.name?.trim();
		if (name) tracker.name = name;
		d.issueTracker = tracker;
	});
}

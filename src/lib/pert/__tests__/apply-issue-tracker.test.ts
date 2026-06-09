import { describe, expect, it } from "vitest";
import { applyIssueTracker } from "../apply-issue-tracker";
import type { PertDoc } from "../types";
import { createEmptyPertDoc } from "../types";

// A synchronous stand-in for Automerge's changeDoc that applies the mutation
// to a plain object — enough to assert the merge result.
function fakeChange(doc: PertDoc) {
	return (mutate: (d: PertDoc) => void) => mutate(doc);
}

describe("applyIssueTracker", () => {
	it("writes the trimmed template and name", () => {
		const doc = createEmptyPertDoc("t");
		applyIssueTracker(fakeChange(doc), {
			urlTemplate: "  https://x/{key}  ",
			name: "  Jira  ",
		});
		expect(doc.issueTracker).toEqual({
			urlTemplate: "https://x/{key}",
			name: "Jira",
		});
	});

	it("omits the name when blank (never assigns undefined)", () => {
		const doc = createEmptyPertDoc("t");
		applyIssueTracker(fakeChange(doc), {
			urlTemplate: "https://x/{key}",
			name: "   ",
		});
		expect(doc.issueTracker).toEqual({ urlTemplate: "https://x/{key}" });
		expect("name" in (doc.issueTracker ?? {})).toBe(false);
	});

	it("clears the tracker when the template is empty", () => {
		const doc = createEmptyPertDoc("t");
		doc.issueTracker = { urlTemplate: "https://x/{key}", name: "Jira" };
		applyIssueTracker(fakeChange(doc), { urlTemplate: "   " });
		expect(doc.issueTracker).toBeUndefined();
	});
});

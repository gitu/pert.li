import { describe, expect, it } from "vitest";
import {
	listDocuments,
	readDocument,
	summarizeProject,
} from "#/lib/ai/tool-mutators";
import {
	createEmptyPertDoc,
	type PertDoc,
	type ProjectDocument,
} from "#/lib/pert/types";

function docWith(...docs: ProjectDocument[]): PertDoc {
	const d = createEmptyPertDoc("Test");
	d.documentsById = {};
	for (const doc of docs) d.documentsById[doc.id] = doc;
	return d;
}

const spec: ProjectDocument = {
	id: "doc_spec",
	name: "spec.md",
	kind: "text",
	text: "Build the login page and the dashboard.",
	truncated: false,
	addedAt: 1_700_000_000_000,
};

const brief: ProjectDocument = {
	id: "doc_brief",
	name: "brief.pdf",
	kind: "pdf",
	text: "A long brief… ".repeat(50),
	pages: 4,
	truncated: true,
	addedAt: 1_700_000_001_000,
};

describe("listDocuments", () => {
	it("returns an empty list when the project has no documents", () => {
		expect(listDocuments(createEmptyPertDoc("p"))).toEqual({ documents: [] });
	});

	it("returns a manifest with sizes but never the text", () => {
		const { documents } = listDocuments(docWith(spec, brief));
		expect(documents).toHaveLength(2);
		const entry = documents.find((e) => e.id === "doc_brief");
		expect(entry).toEqual({
			id: "doc_brief",
			name: "brief.pdf",
			kind: "pdf",
			pages: 4,
			truncated: true,
			charCount: brief.text.length,
		});
		// The manifest must not carry the full text.
		expect(JSON.stringify(documents)).not.toContain("A long brief");
	});
});

describe("readDocument", () => {
	it("returns the full text of an existing document", () => {
		expect(readDocument(docWith(spec), { documentId: "doc_spec" })).toEqual({
			ok: true,
			id: "doc_spec",
			name: "spec.md",
			kind: "text",
			pages: undefined,
			truncated: false,
			text: "Build the login page and the dashboard.",
		});
	});

	it("returns ok:false for an unknown id", () => {
		expect(readDocument(docWith(spec), { documentId: "nope" })).toEqual({
			ok: false,
			error: 'No document with id "nope"',
		});
	});

	it("treats a project with no documents map as empty", () => {
		expect(
			readDocument(createEmptyPertDoc("p"), { documentId: "doc_spec" }),
		).toEqual({ ok: false, error: 'No document with id "doc_spec"' });
	});
});

describe("summarizeProject attachedDocuments", () => {
	it("includes the document manifest", () => {
		const summary = summarizeProject(docWith(spec));
		expect(summary.attachedDocuments).toEqual([
			{
				id: "doc_spec",
				name: "spec.md",
				kind: "text",
				pages: undefined,
				truncated: false,
				charCount: spec.text.length,
			},
		]);
	});

	it("is an empty array for a project without documents", () => {
		expect(summarizeProject(createEmptyPertDoc("p")).attachedDocuments).toEqual(
			[],
		);
	});

	it("does not inline document text into the summary", () => {
		const summary = summarizeProject(docWith(spec, brief));
		expect(JSON.stringify(summary)).not.toContain("Build the login page");
	});
});

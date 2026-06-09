import { describe, expect, it } from "vitest";
import { applyDisplaySettings, writeDisplay } from "../apply-display";
import {
	CANVAS_FIELDS,
	DEFAULT_CANVAS_LAYOUT,
	DEFAULT_OVERVIEW_LAYOUT,
	OVERVIEW_FIELDS,
	resolveDisplaySettings,
} from "../display";
import type { PertDoc } from "../types";
import { createEmptyPertDoc } from "../types";

// Synchronous stand-in for Automerge's changeDoc (mirrors apply-calendar.test).
function fakeChange(doc: PertDoc) {
	return (mutate: (d: PertDoc) => void) => mutate(doc);
}

// A form result with everything at its registry default.
function defaultForm() {
	return {
		overview: {
			layout: DEFAULT_OVERVIEW_LAYOUT,
			fields: Object.fromEntries(
				OVERVIEW_FIELDS.map((f) => [f.id, f.defaultOn]),
			),
		},
		canvas: {
			layout: DEFAULT_CANVAS_LAYOUT,
			fields: Object.fromEntries(CANVAS_FIELDS.map((f) => [f.id, f.defaultOn])),
		},
	};
}

describe("applyDisplaySettings / writeDisplay", () => {
	it("leaves no trace when everything is at default", () => {
		const doc = createEmptyPertDoc("t");
		applyDisplaySettings(fakeChange(doc), defaultForm());
		expect("display" in doc).toBe(false);
	});

	it("clears a prior config when reset to all-defaults", () => {
		const doc = createEmptyPertDoc("t");
		doc.display = { overview: { layout: "compact" } };
		applyDisplaySettings(fakeChange(doc), defaultForm());
		expect("display" in doc).toBe(false);
	});

	it("persists only the non-default layout and fields", () => {
		const doc = createEmptyPertDoc("t");
		const form = defaultForm();
		form.overview.layout = "compact";
		form.overview.fields.count = false; // default is true → persisted
		form.canvas.fields.slack = false; // default is true → persisted
		applyDisplaySettings(fakeChange(doc), form);
		expect(doc.display).toEqual({
			overview: { layout: "compact", fields: { count: false } },
			canvas: { fields: { slack: false } },
		});
	});

	it("never assigns undefined into the doc", () => {
		const doc = createEmptyPertDoc("t");
		const form = defaultForm();
		form.canvas.layout = "compact";
		writeDisplay(doc, form);
		// Only the diverging surface is present; no stray undefined keys.
		expect(doc.display).toEqual({ canvas: { layout: "compact" } });
		expect("overview" in (doc.display ?? {})).toBe(false);
	});

	it("round-trips: resolve(write(form)) reproduces the form's visible state", () => {
		const doc = createEmptyPertDoc("t");
		const form = defaultForm();
		form.overview.layout = "compact";
		form.overview.fields.critical = true; // default false → on
		form.canvas.fields.progress = false;
		writeDisplay(doc, form);
		const resolved = resolveDisplaySettings(doc);
		expect(resolved.overview.layout).toBe("compact");
		expect(resolved.overview.fields.critical).toBe(true);
		expect(resolved.canvas.fields.progress).toBe(false);
		// Untouched fields still resolve to their defaults.
		expect(resolved.overview.fields.count).toBe(true);
	});
});

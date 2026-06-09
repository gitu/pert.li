import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	CANVAS_FIELDS,
	type CanvasFieldId,
	DEFAULT_CANVAS_LAYOUT,
	DEFAULT_OVERVIEW_LAYOUT,
	OVERVIEW_FIELDS,
	type OverviewFieldId,
	resolveDisplaySettings,
} from "../display";
import { createEmptyPertDoc } from "../types";

// All-default resolved shape, derived from the registry so the test follows the
// source of truth rather than hard-coding it.
function defaultsOf(defs: readonly { id: string; defaultOn: boolean }[]) {
	return Object.fromEntries(defs.map((d) => [d.id, d.defaultOn]));
}

describe("resolveDisplaySettings", () => {
	it("returns all defaults for an undefined doc", () => {
		const r = resolveDisplaySettings(undefined);
		expect(r.overview).toEqual({
			layout: DEFAULT_OVERVIEW_LAYOUT,
			fields: defaultsOf(OVERVIEW_FIELDS),
		});
		expect(r.canvas).toEqual({
			layout: DEFAULT_CANVAS_LAYOUT,
			fields: defaultsOf(CANVAS_FIELDS),
		});
	});

	it("returns all defaults for a doc with no display config", () => {
		const r = resolveDisplaySettings(createEmptyPertDoc("t"));
		expect(r.overview.fields).toEqual(defaultsOf(OVERVIEW_FIELDS));
		expect(r.canvas.fields).toEqual(defaultsOf(CANVAS_FIELDS));
	});

	it("resolved fields are TOTAL over each registry", () => {
		const r = resolveDisplaySettings({ display: { overview: { fields: {} } } });
		expect(Object.keys(r.overview.fields).sort()).toEqual(
			OVERVIEW_FIELDS.map((f) => f.id).sort(),
		);
		expect(Object.keys(r.canvas.fields).sort()).toEqual(
			CANVAS_FIELDS.map((f) => f.id).sort(),
		);
	});

	it("lets explicit overrides win and keeps untouched fields at default", () => {
		const r = resolveDisplaySettings({
			display: {
				overview: { layout: "compact", fields: { count: false } },
			},
		});
		expect(r.overview.layout).toBe("compact");
		expect(r.overview.fields.count).toBe(false);
		// duration was not overridden → stays at its registry default (true).
		expect(r.overview.fields.duration).toBe(true);
	});

	it("falls back to the default for an unknown / corrupted layout value", () => {
		const r = resolveDisplaySettings({
			// A forward-version or corrupted mode that isn't a known layout.
			display: { overview: { layout: "spacious" as never } },
		});
		expect(r.overview.layout).toBe(DEFAULT_OVERVIEW_LAYOUT);
	});

	it("ignores unknown keys in the fields map", () => {
		const r = resolveDisplaySettings({
			display: { canvas: { fields: { bogus: false, alsoFake: true } } },
		});
		expect(r.canvas.fields).toEqual(defaultsOf(CANVAS_FIELDS));
		expect("bogus" in r.canvas.fields).toBe(false);
	});

	it("property: every override boolean is reflected, defaults elsewhere", () => {
		const overviewIds = OVERVIEW_FIELDS.map((f) => f.id) as OverviewFieldId[];
		const canvasIds = CANVAS_FIELDS.map((f) => f.id) as CanvasFieldId[];
		fc.assert(
			fc.property(
				fc.dictionary(fc.constantFrom(...overviewIds), fc.boolean()),
				fc.dictionary(fc.constantFrom(...canvasIds), fc.boolean()),
				fc.constantFrom("compact" as const, "detailed" as const),
				(ovFields, cvFields, layout) => {
					const r = resolveDisplaySettings({
						display: {
							overview: { layout, fields: ovFields },
							canvas: { fields: cvFields },
						},
					});
					expect(r.overview.layout).toBe(layout);
					for (const def of OVERVIEW_FIELDS) {
						const expected =
							def.id in ovFields ? ovFields[def.id] : def.defaultOn;
						expect(r.overview.fields[def.id]).toBe(expected);
					}
					for (const def of CANVAS_FIELDS) {
						const expected =
							def.id in cvFields ? cvFields[def.id] : def.defaultOn;
						expect(r.canvas.fields[def.id]).toBe(expected);
					}
				},
			),
		);
	});
});

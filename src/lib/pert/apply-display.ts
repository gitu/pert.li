// DISPLAY-SETTINGS: mutator for the per-project display config. Mirrors
// apply-calendar.ts. `writeDisplay` is the core writer (also reused by the
// "copy to other projects" flow, which runs it against another project's doc
// handle). It persists ONLY values that diverge from their registry default, so
// an all-default config leaves no trace (`delete d.display`) and concurrent
// collaborators toggling different fields produce non-conflicting key writes.
// Automerge rejects `undefined` assignments — we only ever assign concrete
// objects or `delete`.

import {
	CANVAS_FIELDS,
	DEFAULT_CANVAS_LAYOUT,
	DEFAULT_OVERVIEW_LAYOUT,
	OVERVIEW_FIELDS,
} from "./display";
import type {
	CanvasLayoutMode,
	DisplaySettings,
	DisplaySurfaceSettings,
	OverviewLayoutMode,
	PertDoc,
} from "./types";

// The payload DisplaySettingsForm emits via onSave: a full (resolved-shaped)
// layout + fields map per surface. `writeDisplay` distils it down to the sparse
// on-doc form.
export type DisplayFormResult = {
	overview: { layout: OverviewLayoutMode; fields: Record<string, boolean> };
	canvas: { layout: CanvasLayoutMode; fields: Record<string, boolean> };
};

// Reduce one surface's full layout+fields into the sparse persisted shape, or
// undefined when everything is at its default (so the caller can omit the key).
function reduceSurface<Mode extends string>(
	next: { layout: Mode; fields: Record<string, boolean> },
	defaultLayout: Mode,
	defs: readonly { id: string; defaultOn: boolean }[],
): DisplaySurfaceSettings<Mode> | undefined {
	const surface: DisplaySurfaceSettings<Mode> = {};
	if (next.layout !== defaultLayout) surface.layout = next.layout;
	const fields: Record<string, boolean> = {};
	for (const def of defs) {
		const value = next.fields[def.id];
		if (typeof value === "boolean" && value !== def.defaultOn) {
			fields[def.id] = value;
		}
	}
	if (Object.keys(fields).length > 0) surface.fields = fields;
	return surface.layout !== undefined || surface.fields !== undefined
		? surface
		: undefined;
}

// Write a form result into a doc in place. Used both by the in-place
// `applyDisplaySettings` (current project) and by the copy-to-projects flow
// (other projects' doc handles).
export function writeDisplay(d: PertDoc, next: DisplayFormResult): void {
	const overview = reduceSurface(
		next.overview,
		DEFAULT_OVERVIEW_LAYOUT,
		OVERVIEW_FIELDS,
	);
	const canvas = reduceSurface(
		next.canvas,
		DEFAULT_CANVAS_LAYOUT,
		CANVAS_FIELDS,
	);

	if (overview === undefined && canvas === undefined) {
		// Everything is default — leave no trace (and clear any prior config).
		delete d.display;
		return;
	}
	const display: DisplaySettings = {};
	if (overview !== undefined) display.overview = overview;
	if (canvas !== undefined) display.canvas = canvas;
	d.display = display;
}

// Merge a display-form result back into the active doc via its changeDoc.
export function applyDisplaySettings(
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	next: DisplayFormResult,
): void {
	changeDoc((d) => writeDisplay(d, next));
}

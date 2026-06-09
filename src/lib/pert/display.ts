// DISPLAY-SETTINGS: pure registry + resolver for per-project display config.
// Dependency-free (type-only import from ./types) so it can be exhaustively
// property-tested. Owns the FieldId unions, the human labels, the per-field
// defaults, and `resolveDisplaySettings`, which turns the sparse/optional
// `doc.display` into a TOTAL shape so every consumer (overview-groups,
// task-node, the form) reads `resolved.fields[id]` without `?? default`.

import type {
	CanvasLayoutMode,
	DisplaySettings,
	OverviewLayoutMode,
	PertDoc,
} from "./types";

// Overview "Groups" row fields map onto GroupRollup (projection.ts):
//   count    → rollup.descendantCount
//   duration → rollup.expected
//   progress → rollup.progress (bar + %)
//   critical → rollup.hasCritical (badge)
export type OverviewFieldId = "count" | "duration" | "progress" | "critical";

// Canvas node fields map onto what task-node.tsx renders:
//   duration → expected-days label
//   slack    → "Nd slack" / "critical" meta
//   progress → the in-flight/done progress bar
// POST-ISSUE-LINKS: add `"issueKeys"` here (see seam below) once the issue-links
// feature merges, so the issue-link badge becomes a toggleable field.
export type CanvasFieldId = "duration" | "slack" | "progress";

export type FieldDef<Id extends string> = {
	id: Id;
	label: string; // shown in the toggle UI
	defaultOn: boolean;
};

export const OVERVIEW_FIELDS: readonly FieldDef<OverviewFieldId>[] = [
	{ id: "count", label: "Task count", defaultOn: true },
	{ id: "duration", label: "Expected duration", defaultOn: true },
	{ id: "progress", label: "Progress", defaultOn: true },
	{ id: "critical", label: "Critical-path badge", defaultOn: false },
];

export const CANVAS_FIELDS: readonly FieldDef<CanvasFieldId>[] = [
	{ id: "duration", label: "Duration", defaultOn: true },
	{ id: "slack", label: "Slack / critical", defaultOn: true },
	{ id: "progress", label: "Progress bar", defaultOn: true },
	// POST-ISSUE-LINKS: { id: "issueKeys", label: "Issue links", defaultOn: true },
];

export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayoutMode = "detailed";
export const DEFAULT_CANVAS_LAYOUT: CanvasLayoutMode = "detailed";

// The known layout modes per surface. `resolveSurface` validates a doc's stored
// layout against these — a corrupted or forward-version value falls back to the
// default rather than flowing through (the config is collaborator-shared, so a
// bad value must not survive a re-save/copy).
export const OVERVIEW_LAYOUTS: readonly OverviewLayoutMode[] = [
	"compact",
	"detailed",
];
export const CANVAS_LAYOUTS: readonly CanvasLayoutMode[] = [
	"compact",
	"detailed",
];

// Fully-resolved, no-optional shape consumers read. `fields` is a TOTAL record
// over the registry ids for that surface, so callers index it directly.
export type ResolvedSurface<Mode extends string, Id extends string> = {
	layout: Mode;
	fields: Record<Id, boolean>;
};

export type ResolvedDisplaySettings = {
	overview: ResolvedSurface<OverviewLayoutMode, OverviewFieldId>;
	canvas: ResolvedSurface<CanvasLayoutMode, CanvasFieldId>;
};

function resolveSurface<Mode extends string, Id extends string>(
	defs: readonly FieldDef<Id>[],
	layouts: readonly Mode[],
	defaultLayout: Mode,
	raw: { layout?: Mode; fields?: Record<string, boolean> } | undefined,
): ResolvedSurface<Mode, Id> {
	const fields = {} as Record<Id, boolean>;
	for (const def of defs) {
		const override = raw?.fields?.[def.id];
		// Only a real boolean override wins; anything else (undefined, or an
		// unknown/garbage key that isn't in the registry) falls back to default.
		fields[def.id] = typeof override === "boolean" ? override : def.defaultOn;
	}
	// Validate layout the same way as fields: only a KNOWN mode wins. A corrupted
	// or forward-version string falls back to the default rather than flowing
	// through into the resolved (and thus re-saveable / copyable) settings.
	const rawLayout = raw?.layout;
	const layout =
		rawLayout !== undefined &&
		(layouts as readonly string[]).includes(rawLayout)
			? rawLayout
			: defaultLayout;
	return { layout, fields };
}

// Total resolver: fills every field + layout default. Tolerates undefined docs,
// empty config, and unknown keys (ignored) — forward/backward compatible.
export function resolveDisplaySettings(
	doc: Pick<PertDoc, "display"> | undefined,
): ResolvedDisplaySettings {
	const display: DisplaySettings | undefined = doc?.display;
	return {
		overview: resolveSurface(
			OVERVIEW_FIELDS,
			OVERVIEW_LAYOUTS,
			DEFAULT_OVERVIEW_LAYOUT,
			display?.overview,
		),
		canvas: resolveSurface(
			CANVAS_FIELDS,
			CANVAS_LAYOUTS,
			DEFAULT_CANVAS_LAYOUT,
			display?.canvas,
		),
	};
}

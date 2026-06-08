import { Store, useStore } from "@tanstack/react-store";

// Per-user, per-project canvas display preferences. Stored in localStorage
// (single-tab fan-out is fine — this isn't collaborative state). Same
// shape/persistence pattern as the collapse store, so the project route
// loads it for free.
//
// Why not in the Automerge doc? Edge style and graph tightness are visual
// preferences, not project content. Two collaborators legitimately want
// different settings (smoothstep vs bezier is just taste).

export type EdgeStyle =
	| "smoothstep" // rounded elbow
	| "step" // hard right-angle elbow
	| "straight" // direct line
	| "bezier" // full cubic — React Flow's "default" (default)
	| "simplebezier"; // tighter symmetric cubic

export const EDGE_STYLES: ReadonlyArray<{
	value: EdgeStyle;
	label: string;
	description: string;
}> = [
	{
		value: "smoothstep",
		label: "Elbow (rounded)",
		description: "Right-angle steps with rounded corners.",
	},
	{
		value: "step",
		label: "Elbow (sharp)",
		description: "Right-angle steps with hard corners.",
	},
	{
		value: "straight",
		label: "Straight",
		description: "Direct line, ignores ports.",
	},
	{
		value: "bezier",
		label: "Cubic bezier",
		description:
			"Asymmetric curve following the source/target handle direction.",
	},
	{
		value: "simplebezier",
		label: "Simple bezier",
		description: "Tighter symmetric cubic that hugs the midline.",
	},
];

// Map our short name to the React Flow `edge.type` string. Bezier is
// "default" in their codebase; everything else matches directly.
export const EDGE_STYLE_TO_REACT_FLOW_TYPE: Record<EdgeStyle, string> = {
	smoothstep: "smoothstep",
	step: "step",
	straight: "straight",
	bezier: "default",
	simplebezier: "simplebezier",
};

export function isEdgeStyle(value: unknown): value is EdgeStyle {
	return (
		typeof value === "string" && EDGE_STYLES.some((s) => s.value === value)
	);
}

export type LayoutSpacing = "compact" | "comfortable" | "spacious";

export type CanvasPrefs = {
	edgeStyle: EdgeStyle;
	spacing: LayoutSpacing;
	// When on, the canvas re-runs ELK auto-layout after every doc change and
	// pans the viewport so the currently selected node visually stays put.
	// Off by default — manual layout is the safer baseline.
	continuousLayout: boolean;
	// Depth cap for group boxes (WBS level, 1-based). Only groups at or below
	// this level render as boxes; deeper groups fold their tasks into the nearest
	// shown ancestor. `Number.POSITIVE_INFINITY` = all levels (default); `0` =
	// grouping off (flat graph, no boxes).
	groupingMaxLevel: number;
};

const DEFAULT_PREFS: CanvasPrefs = {
	edgeStyle: "bezier",
	spacing: "comfortable",
	continuousLayout: false,
	groupingMaxLevel: Number.POSITIVE_INFINITY,
};

// Highest finite cap the UI can represent (Off / 1 / 2 / 3 / All). Anything
// above this is indistinguishable from "All" for any realistic group tree.
const MAX_UI_GROUPING_LEVEL = 3;

// Normalize a persisted grouping cap. `JSON.stringify(Infinity)` becomes `null`,
// so a stored "All" round-trips as null/undefined — both map back to All. `0`
// (grouping off) and 1–3 survive as-is; any finite value above the UI range
// collapses to "All" so the stored value and the Display radio never disagree
// (a hand-edited / legacy `4+` would otherwise show "All" but behave as that
// level, then silently change on re-save).
export function normalizeGroupingMaxLevel(value: unknown): number {
	if (value === 0) return 0;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		const n = Math.floor(value);
		return n <= MAX_UI_GROUPING_LEVEL ? n : Number.POSITIVE_INFINITY;
	}
	return Number.POSITIVE_INFINITY;
}

// Coerce a possibly-partial / hand-edited stored entry into a full, valid prefs
// object. Shared by the imperative getter and the React hook.
function normalizePrefs(stored: Partial<CanvasPrefs> | undefined): CanvasPrefs {
	if (!stored) return DEFAULT_PREFS;
	return {
		edgeStyle: isEdgeStyle(stored.edgeStyle)
			? stored.edgeStyle
			: DEFAULT_PREFS.edgeStyle,
		spacing: stored.spacing ?? DEFAULT_PREFS.spacing,
		continuousLayout: stored.continuousLayout ?? DEFAULT_PREFS.continuousLayout,
		groupingMaxLevel: normalizeGroupingMaxLevel(stored.groupingMaxLevel),
	};
}

type PrefsState = Record<string, CanvasPrefs>;

const STORAGE_KEY = "pertli.canvas-prefs";

function readStorage(): PrefsState {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed as PrefsState;
	} catch {
		// fall through to empty
	}
	return {};
}

function writeStorage(state: PrefsState): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// quota / disabled storage — silent fall-through is fine for prefs
	}
}

export const canvasPrefsStore = new Store<PrefsState>(readStorage());

canvasPrefsStore.subscribe(() => {
	writeStorage(canvasPrefsStore.state);
});

export function getCanvasPrefs(projectId: string): CanvasPrefs {
	// Forward-compat: stored values that are no longer recognised (or were
	// hand-edited) fall back to defaults rather than rendering indeterminate.
	return normalizePrefs(canvasPrefsStore.state[projectId]);
}

export function setEdgeStyle(projectId: string, edgeStyle: EdgeStyle): void {
	canvasPrefsStore.setState((s) => ({
		...s,
		[projectId]: { ...(s[projectId] ?? DEFAULT_PREFS), edgeStyle },
	}));
}

export function setLayoutSpacing(
	projectId: string,
	spacing: LayoutSpacing,
): void {
	canvasPrefsStore.setState((s) => ({
		...s,
		[projectId]: { ...(s[projectId] ?? DEFAULT_PREFS), spacing },
	}));
}

export function setContinuousLayout(
	projectId: string,
	continuousLayout: boolean,
): void {
	canvasPrefsStore.setState((s) => ({
		...s,
		[projectId]: { ...(s[projectId] ?? DEFAULT_PREFS), continuousLayout },
	}));
}

export function setGroupingMaxLevel(
	projectId: string,
	groupingMaxLevel: number,
): void {
	canvasPrefsStore.setState((s) => ({
		...s,
		[projectId]: {
			...(s[projectId] ?? DEFAULT_PREFS),
			groupingMaxLevel: normalizeGroupingMaxLevel(groupingMaxLevel),
		},
	}));
}

export function useCanvasPrefs(projectId: string): CanvasPrefs {
	return useStore(canvasPrefsStore, (s) => normalizePrefs(s[projectId]));
}

// ELK tightness mapping. Tighter packing trades off readability for
// information density. We expose three named presets to keep the UI clean
// — fine-tuned values land in the engine here.
export const SPACING_PRESETS: Record<
	LayoutSpacing,
	{
		nodeNode: number;
		betweenLayers: number;
		edgeNode: number;
	}
> = {
	compact: { nodeNode: 18, betweenLayers: 48, edgeNode: 12 },
	comfortable: { nodeNode: 40, betweenLayers: 80, edgeNode: 24 },
	spacious: { nodeNode: 72, betweenLayers: 140, edgeNode: 40 },
};

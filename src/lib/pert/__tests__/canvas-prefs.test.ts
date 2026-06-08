import { beforeEach, describe, expect, it } from "vitest";
import {
	canvasPrefsStore,
	EDGE_STYLE_TO_REACT_FLOW_TYPE,
	EDGE_STYLES,
	getCanvasPrefs,
	isEdgeStyle,
	normalizeGroupingMaxLevel,
	SPACING_PRESETS,
	setEdgeStyle,
	setGroupingMaxLevel,
	setLayoutSpacing,
} from "#/lib/pert/canvas-prefs";

const ALL = Number.POSITIVE_INFINITY;

beforeEach(() => {
	canvasPrefsStore.setState(() => ({}));
	if (typeof window !== "undefined") {
		window.localStorage.removeItem("pertli.canvas-prefs");
	}
});

describe("canvasPrefsStore", () => {
	it("returns defaults when no prefs are stored for the project", () => {
		expect(getCanvasPrefs("p1")).toEqual({
			edgeStyle: "bezier",
			spacing: "comfortable",
			continuousLayout: false,
			groupingMaxLevel: ALL,
		});
	});

	it("setEdgeStyle and setLayoutSpacing are isolated per project", () => {
		setEdgeStyle("p1", "bezier");
		setLayoutSpacing("p1", "spacious");
		setEdgeStyle("p2", "smoothstep");
		setLayoutSpacing("p2", "compact");

		expect(getCanvasPrefs("p1")).toEqual({
			edgeStyle: "bezier",
			spacing: "spacious",
			continuousLayout: false,
			groupingMaxLevel: ALL,
		});
		expect(getCanvasPrefs("p2")).toEqual({
			edgeStyle: "smoothstep",
			spacing: "compact",
			continuousLayout: false,
			groupingMaxLevel: ALL,
		});
	});

	it("setEdgeStyle keeps the spacing untouched and vice versa", () => {
		setLayoutSpacing("p1", "compact");
		setEdgeStyle("p1", "bezier");
		expect(getCanvasPrefs("p1")).toEqual({
			edgeStyle: "bezier",
			spacing: "compact",
			continuousLayout: false,
			groupingMaxLevel: ALL,
		});
	});

	it("setGroupingMaxLevel is isolated and leaves other prefs untouched", () => {
		setLayoutSpacing("p1", "compact");
		setGroupingMaxLevel("p1", 2);
		setGroupingMaxLevel("p2", 0);
		expect(getCanvasPrefs("p1")).toEqual({
			edgeStyle: "bezier",
			spacing: "compact",
			continuousLayout: false,
			groupingMaxLevel: 2,
		});
		expect(getCanvasPrefs("p2").groupingMaxLevel).toBe(0);
	});

	it("round-trips the 'All' sentinel through JSON (Infinity → null → All)", () => {
		setGroupingMaxLevel("p1", ALL);
		// JSON is how the store persists to localStorage; Infinity serializes to
		// null, so a naive read would lose "All". The normalizer must restore it.
		const raw = JSON.stringify(canvasPrefsStore.state);
		expect(raw).toContain('"groupingMaxLevel":null');
		// Rehydrate from the serialized form (simulate a fresh tab).
		canvasPrefsStore.setState(() => JSON.parse(raw));
		expect(getCanvasPrefs("p1").groupingMaxLevel).toBe(ALL);
	});

	it("subscribers see each setter's state change", () => {
		const seen: string[] = [];
		canvasPrefsStore.subscribe(() => {
			const p = canvasPrefsStore.state.p1;
			if (p) seen.push(`${p.edgeStyle}-${p.spacing}`);
		});
		setEdgeStyle("p1", "bezier");
		setLayoutSpacing("p1", "spacious");
		expect(seen).toEqual(["bezier-comfortable", "bezier-spacious"]);
	});
});

describe("EDGE_STYLES + helpers", () => {
	it("includes the five React Flow built-ins", () => {
		expect(EDGE_STYLES.map((s) => s.value).sort()).toEqual([
			"bezier",
			"simplebezier",
			"smoothstep",
			"step",
			"straight",
		]);
	});

	it("maps every style to a React Flow type string", () => {
		for (const style of EDGE_STYLES) {
			expect(EDGE_STYLE_TO_REACT_FLOW_TYPE[style.value]).toBeTruthy();
		}
		// `bezier` is the only one whose RF type doesn't match the union name.
		expect(EDGE_STYLE_TO_REACT_FLOW_TYPE.bezier).toBe("default");
	});

	it("isEdgeStyle narrows valid + rejects unknown", () => {
		expect(isEdgeStyle("smoothstep")).toBe(true);
		expect(isEdgeStyle("step")).toBe(true);
		expect(isEdgeStyle("bezier")).toBe(true);
		expect(isEdgeStyle("squiggle")).toBe(false);
		expect(isEdgeStyle(null)).toBe(false);
	});

	it("getCanvasPrefs sanitises an unknown stored edgeStyle to default", () => {
		// Simulate a forward-compat / hand-edited localStorage value.
		canvasPrefsStore.setState(() => ({
			p1: {
				edgeStyle: "squiggle" as unknown as "smoothstep",
				spacing: "compact",
				continuousLayout: false,
				groupingMaxLevel: ALL,
			},
		}));
		expect(getCanvasPrefs("p1")).toEqual({
			edgeStyle: "bezier",
			spacing: "compact",
			continuousLayout: false,
			groupingMaxLevel: ALL,
		});
	});
});

describe("normalizeGroupingMaxLevel", () => {
	it("treats null/undefined/non-finite as All (infinity)", () => {
		expect(normalizeGroupingMaxLevel(null)).toBe(ALL);
		expect(normalizeGroupingMaxLevel(undefined)).toBe(ALL);
		expect(normalizeGroupingMaxLevel(ALL)).toBe(ALL);
		expect(normalizeGroupingMaxLevel("nope")).toBe(ALL);
	});

	it("keeps 0 (off) and the UI-representable levels 1–3", () => {
		expect(normalizeGroupingMaxLevel(0)).toBe(0);
		expect(normalizeGroupingMaxLevel(1)).toBe(1);
		expect(normalizeGroupingMaxLevel(3)).toBe(3);
		expect(normalizeGroupingMaxLevel(2.7)).toBe(2);
	});

	it("collapses finite caps above the UI range (>3) to All", () => {
		// Otherwise the Display radio would show "All" but behave as level 4+,
		// then silently change the stored value on the next save.
		expect(normalizeGroupingMaxLevel(4)).toBe(ALL);
		expect(normalizeGroupingMaxLevel(99)).toBe(ALL);
	});

	it("clamps negatives up to All rather than producing a nonsense cap", () => {
		expect(normalizeGroupingMaxLevel(-5)).toBe(ALL);
	});
});

describe("SPACING_PRESETS", () => {
	it("orders compact < comfortable < spacious for every axis", () => {
		const axes = ["nodeNode", "betweenLayers", "edgeNode"] as const;
		for (const axis of axes) {
			expect(SPACING_PRESETS.compact[axis]).toBeLessThan(
				SPACING_PRESETS.comfortable[axis],
			);
			expect(SPACING_PRESETS.comfortable[axis]).toBeLessThan(
				SPACING_PRESETS.spacious[axis],
			);
		}
	});
});

// Pure formatting helpers shared between the history drawer, presence
// overlay, and any UI that needs to colour-code or label an actor. Kept
// separate from `history.ts` so consumers (Storybook stories, unit tests)
// don't transitively import the Automerge wasm runtime.

// Short actor id for display. Automerge actor ids are 32 hex chars. The
// first 4 are plenty to disambiguate in practice and play well with a
// colour swatch.
export function shortActor(actor: string): string {
	return actor.slice(0, 4);
}

// Stable hash → colour for actor swatches. Hue only — saturation/lightness
// fixed so light/dark themes both stay legible.
export function actorColor(actor: string): string {
	let h = 0;
	for (let i = 0; i < actor.length; i++) {
		h = (h * 31 + actor.charCodeAt(i)) >>> 0;
	}
	const hue = h % 360;
	return `hsl(${hue}, 70%, 55%)`;
}

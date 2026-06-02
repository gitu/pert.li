// Stub for `@tanstack/react-start/server`. Components / server modules
// imported transitively from stories may pull `getRequest`, `getEvent`, etc.
// We return undefined-ish values — stories don't depend on these existing.

export function getRequest(): never {
	throw new Error("getRequest is not available in Storybook.");
}
export function getEvent(): never {
	throw new Error("getEvent is not available in Storybook.");
}
export const json = (v: unknown) => v;

export default {};

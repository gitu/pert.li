// Storybook-only stub for `@tanstack/react-start`. The real package pulls in
// Nitro runtime helpers via the `#tanstack-start-entry` subpath import that
// Storybook's vite environment can't resolve. Stories never actually call a
// server fn — they pre-seed TanStack Query caches or render with no-op
// handlers — so we provide a builder that throws if called.

class ServerFnBuilder {
	inputValidator<T>(_validator: (data: unknown) => T): this {
		return this;
	}
	handler(_fn: (...args: unknown[]) => unknown) {
		return async () => {
			throw new Error(
				"Server fns are not executable in Storybook. Stub the data in the story instead.",
			);
		};
	}
}

export function createServerFn(_opts?: { method?: string }) {
	return new ServerFnBuilder();
}

export default {};

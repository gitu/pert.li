// Type declaration for the plain-JS build-version helper imported by
// vite.config.ts. The implementation lives in compute-version.mjs (kept as
// .mjs so CI/Docker can run it with bare `node` without a TS toolchain).

export function getAppVersion(opts?: {
	env?: Record<string, string | undefined>;
	exec?: () => string | null;
}): string;

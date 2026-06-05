import { createContext, useContext } from "react";

// Runtime white-label configuration for self-hosted / custom installations.
//
// Operators rebrand the app and tune the privacy policy via plain process.env
// vars resolved on the SERVER at request time (see src/server/config.ts) — no
// rebuild required, unlike the build-time `import.meta.env.VITE_*` knobs. The
// resolved config is threaded into the page through the root route loader and
// exposed to components via AppConfigContext below.
//
//   APP_NAME                 visible brand / wordmark text         (default "pert.li")
//   APP_TITLE                browser document <title>              (default derived)
//   PRIVACY_POLICY_URL       redirect /privacy to an external URL  (existing)
//   PRIVACY_POLICY_DISABLED  "1"/"true" → drop privacy entirely    (new)

export type PrivacyMode = "default" | "external" | "disabled";

export interface AppConfig {
	/** Visible brand / wordmark shown across chrome and public pages. */
	appName: string;
	/** Browser document <title>. */
	appTitle: string;
	privacy: {
		mode: PrivacyMode;
		/** Set only when mode === "external". */
		externalUrl: string | null;
	};
}

const DEFAULT_APP_NAME = "pert.li";
const DEFAULT_APP_TITLE = "pert.li — collaborative PERT planning";

export const DEFAULT_APP_CONFIG: AppConfig = {
	appName: DEFAULT_APP_NAME,
	appTitle: DEFAULT_APP_TITLE,
	privacy: { mode: "default", externalUrl: null },
};

function cleaned(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isTruthyFlag(value: string | undefined): boolean {
	const v = cleaned(value)?.toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

// The privacy redirect target comes from operator-set env, so this isn't an
// untrusted-input boundary — but a typo (missing scheme) or a non-navigable
// scheme (`javascript:`, `data:`) would produce a broken or surprising
// redirect. Accept only http(s) absolute URLs and same-origin absolute paths;
// anything else is treated as unset so we fall back to the built-in policy.
function isSafeRedirectTarget(value: string): boolean {
	// Same-origin absolute path, but not protocol-relative ("//host" → off-origin).
	if (value.startsWith("/")) return !value.startsWith("//");
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

// Pure resolver so it's trivially unit-testable and isomorphic (the server fn
// passes process.env; tests pass a literal). Never throws — unknown/empty vars
// fall back to the hosted defaults.
export function resolveAppConfig(
	env: Record<string, string | undefined>,
): AppConfig {
	const appName = cleaned(env.APP_NAME) ?? DEFAULT_APP_NAME;
	// If only APP_NAME is set, derive the tab title from it; preserve the full
	// hosted tagline when nothing is overridden.
	const appTitle =
		cleaned(env.APP_TITLE) ??
		(appName === DEFAULT_APP_NAME ? DEFAULT_APP_TITLE : appName);

	const externalUrlRaw = cleaned(env.PRIVACY_POLICY_URL) ?? null;
	// A misconfigured (unsafe / unparseable) URL falls back to the built-in
	// policy rather than the operator's intended external page — but it never
	// produces an unsafe navigation.
	const externalUrl =
		externalUrlRaw && isSafeRedirectTarget(externalUrlRaw)
			? externalUrlRaw
			: null;
	const disabled = isTruthyFlag(env.PRIVACY_POLICY_DISABLED);

	// Precedence: DISABLED wins over URL; otherwise URL → external; else default.
	const privacy: AppConfig["privacy"] = disabled
		? { mode: "disabled", externalUrl: null }
		: externalUrl
			? { mode: "external", externalUrl }
			: { mode: "default", externalUrl: null };

	return { appName, appTitle, privacy };
}

// Defaulted context: components rendered outside a provider (Storybook isolated
// renders, tests) still get sane brand/privacy without any router or wrapper.
export const AppConfigContext = createContext<AppConfig>(DEFAULT_APP_CONFIG);

export function useAppConfig(): AppConfig {
	return useContext(AppConfigContext);
}

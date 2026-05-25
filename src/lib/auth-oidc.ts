// Parses the OIDC_* env vars into a single config object that the better-auth
// genericOAuth plugin can consume. Kept as a pure function so it can be unit-
// tested without touching better-auth or process.env.
//
// We deliberately support exactly one provider for now — on-prem deployments
// typically have one IdP (their own Keycloak/Authentik, or Entra ID for
// Microsoft shops) and the signin UI is simpler with a single button. If a
// deployment ever needs multiple, the parser can grow to read an indexed shape
// (OIDC_1_*, OIDC_2_*).

export type OidcEnv = Record<string, string | undefined>;

export type OidcProviderConfig = {
	/** Internal id, also the URL segment for /api/auth/oauth2/callback/{id} */
	providerId: string;
	/** Label shown on the signin button ("Sign in with {displayName}") */
	displayName: string;
	/** Standard OIDC well-known URL */
	discoveryUrl: string;
	clientId: string;
	clientSecret: string;
	scopes: string[];
};

/** Subset of the config that's safe to ship to the browser (no secrets). */
export type OidcPublicInfo = Pick<
	OidcProviderConfig,
	"providerId" | "displayName"
>;

const DEFAULT_PROVIDER_ID = "oidc";
const DEFAULT_DISPLAY_NAME = "SSO";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

export function parseOidcConfig(env: OidcEnv): OidcProviderConfig | null {
	const discoveryUrl = env.OIDC_DISCOVERY_URL?.trim();
	const clientId = env.OIDC_CLIENT_ID?.trim();
	const clientSecret = env.OIDC_CLIENT_SECRET?.trim();
	if (!discoveryUrl || !clientId || !clientSecret) return null;

	const scopes =
		env.OIDC_SCOPES?.split(",")
			.map((s) => s.trim())
			.filter(Boolean) ?? DEFAULT_SCOPES;

	return {
		providerId: env.OIDC_PROVIDER_ID?.trim() || DEFAULT_PROVIDER_ID,
		displayName: env.OIDC_PROVIDER_NAME?.trim() || DEFAULT_DISPLAY_NAME,
		discoveryUrl,
		clientId,
		clientSecret,
		scopes,
	};
}

export function toPublicInfo(config: OidcProviderConfig): OidcPublicInfo {
	return { providerId: config.providerId, displayName: config.displayName };
}

import { describe, expect, it } from "vitest";
import { parseOidcConfig, toPublicInfo } from "../auth-oidc";

describe("parseOidcConfig", () => {
	it("returns null when no OIDC env vars are present", () => {
		expect(parseOidcConfig({})).toBeNull();
	});

	it("returns null when any required value is missing", () => {
		const base = {
			OIDC_DISCOVERY_URL:
				"https://idp.example.com/.well-known/openid-configuration",
			OIDC_CLIENT_ID: "abc",
			OIDC_CLIENT_SECRET: "shh",
		};
		expect(parseOidcConfig({ ...base, OIDC_CLIENT_ID: undefined })).toBeNull();
		expect(parseOidcConfig({ ...base, OIDC_CLIENT_SECRET: "" })).toBeNull();
		expect(parseOidcConfig({ ...base, OIDC_DISCOVERY_URL: "   " })).toBeNull();
	});

	it("parses a minimal config with sensible defaults", () => {
		const config = parseOidcConfig({
			OIDC_DISCOVERY_URL:
				"https://idp.example.com/.well-known/openid-configuration",
			OIDC_CLIENT_ID: "client",
			OIDC_CLIENT_SECRET: "secret",
		});
		expect(config).toEqual({
			providerId: "oidc",
			displayName: "SSO",
			discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
			clientId: "client",
			clientSecret: "secret",
			scopes: ["openid", "email", "profile"],
			autoRedirect: false,
		});
	});

	it("parses OIDC_AUTO_REDIRECT as a truthy flag", () => {
		const base = {
			OIDC_DISCOVERY_URL:
				"https://idp.example.com/.well-known/openid-configuration",
			OIDC_CLIENT_ID: "client",
			OIDC_CLIENT_SECRET: "secret",
		};
		expect(parseOidcConfig(base)?.autoRedirect).toBe(false);
		expect(
			parseOidcConfig({ ...base, OIDC_AUTO_REDIRECT: "1" })?.autoRedirect,
		).toBe(true);
		expect(
			parseOidcConfig({ ...base, OIDC_AUTO_REDIRECT: "true" })?.autoRedirect,
		).toBe(true);
		expect(
			parseOidcConfig({ ...base, OIDC_AUTO_REDIRECT: "  TRUE " })?.autoRedirect,
		).toBe(true);
		expect(
			parseOidcConfig({ ...base, OIDC_AUTO_REDIRECT: "0" })?.autoRedirect,
		).toBe(false);
		expect(
			parseOidcConfig({ ...base, OIDC_AUTO_REDIRECT: "yes" })?.autoRedirect,
		).toBe(false);
	});

	it("uses provided id/name/scopes overrides", () => {
		const config = parseOidcConfig({
			OIDC_PROVIDER_ID: "entra",
			OIDC_PROVIDER_NAME: "Microsoft Entra ID",
			OIDC_DISCOVERY_URL:
				"https://login.microsoftonline.com/contoso/v2.0/.well-known/openid-configuration",
			OIDC_CLIENT_ID: "client",
			OIDC_CLIENT_SECRET: "secret",
			OIDC_SCOPES: "openid, profile, email, offline_access",
		});
		expect(config?.providerId).toBe("entra");
		expect(config?.displayName).toBe("Microsoft Entra ID");
		expect(config?.scopes).toEqual([
			"openid",
			"profile",
			"email",
			"offline_access",
		]);
	});

	it("trims surrounding whitespace on all inputs", () => {
		const config = parseOidcConfig({
			OIDC_PROVIDER_ID: "  entra  ",
			OIDC_PROVIDER_NAME: "  Entra  ",
			OIDC_DISCOVERY_URL:
				"  https://idp.example.com/.well-known/openid-configuration  ",
			OIDC_CLIENT_ID: "  client  ",
			OIDC_CLIENT_SECRET: "  secret  ",
		});
		expect(config?.providerId).toBe("entra");
		expect(config?.displayName).toBe("Entra");
		expect(config?.clientId).toBe("client");
		expect(config?.clientSecret).toBe("secret");
	});
});

describe("toPublicInfo", () => {
	it("strips secrets, leaving only id + display name + autoRedirect", () => {
		const info = toPublicInfo({
			providerId: "entra",
			displayName: "Entra ID",
			discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
			clientId: "client",
			clientSecret: "secret",
			scopes: ["openid"],
			autoRedirect: true,
		});
		expect(info).toEqual({
			providerId: "entra",
			displayName: "Entra ID",
			autoRedirect: true,
		});
		// Make sure no other keys (secrets, urls, scopes) leak through.
		expect(Object.keys(info).sort()).toEqual([
			"autoRedirect",
			"displayName",
			"providerId",
		]);
	});
});

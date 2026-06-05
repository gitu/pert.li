import { describe, expect, it } from "vitest";
import { DEFAULT_APP_CONFIG, resolveAppConfig } from "./app-config";

describe("resolveAppConfig", () => {
	it("returns the hosted defaults for an empty env", () => {
		expect(resolveAppConfig({})).toEqual(DEFAULT_APP_CONFIG);
	});

	it("ignores empty / whitespace-only overrides", () => {
		expect(
			resolveAppConfig({
				APP_NAME: "   ",
				APP_TITLE: "",
				PRIVACY_POLICY_URL: "  ",
			}),
		).toEqual(DEFAULT_APP_CONFIG);
	});

	describe("brand title", () => {
		it("derives the document title from APP_NAME when only the name is set", () => {
			const cfg = resolveAppConfig({ APP_NAME: "Acme Planner" });
			expect(cfg.appName).toBe("Acme Planner");
			expect(cfg.appTitle).toBe("Acme Planner");
		});

		it("keeps the full hosted tagline when nothing is overridden", () => {
			expect(resolveAppConfig({}).appTitle).toBe(
				"pert.li — collaborative PERT planning",
			);
		});

		it("lets APP_TITLE override the document title independently of APP_NAME", () => {
			const cfg = resolveAppConfig({
				APP_NAME: "Acme Planner",
				APP_TITLE: "Acme Planner — internal estimator",
			});
			expect(cfg.appName).toBe("Acme Planner");
			expect(cfg.appTitle).toBe("Acme Planner — internal estimator");
		});

		it("allows APP_TITLE without APP_NAME (brand stays default)", () => {
			const cfg = resolveAppConfig({ APP_TITLE: "My Custom Tab Title" });
			expect(cfg.appName).toBe("pert.li");
			expect(cfg.appTitle).toBe("My Custom Tab Title");
		});

		it("trims surrounding whitespace from overrides", () => {
			const cfg = resolveAppConfig({
				APP_NAME: "  Acme  ",
				APP_TITLE: "  Acme Tab  ",
			});
			expect(cfg.appName).toBe("Acme");
			expect(cfg.appTitle).toBe("Acme Tab");
		});
	});

	describe("privacy mode", () => {
		it("defaults to the built-in policy", () => {
			expect(resolveAppConfig({}).privacy).toEqual({
				mode: "default",
				externalUrl: null,
			});
		});

		it("redirects to an external policy when PRIVACY_POLICY_URL is set", () => {
			expect(
				resolveAppConfig({
					PRIVACY_POLICY_URL: "https://acme.example/legal/privacy",
				}).privacy,
			).toEqual({
				mode: "external",
				externalUrl: "https://acme.example/legal/privacy",
			});
		});

		it("allows http and same-origin absolute-path redirect targets", () => {
			for (const url of [
				"http://acme.example/privacy",
				"https://acme.example/privacy",
				"/legal/privacy",
			]) {
				expect(resolveAppConfig({ PRIVACY_POLICY_URL: url }).privacy).toEqual({
					mode: "external",
					externalUrl: url,
				});
			}
		});

		it("falls back to the built-in policy for unsafe / unparseable URLs", () => {
			for (const url of [
				"javascript:alert(1)",
				"data:text/html,<script>alert(1)</script>",
				"//evil.example/phish",
				"not a url",
				"ftp://acme.example/privacy",
			]) {
				expect(resolveAppConfig({ PRIVACY_POLICY_URL: url }).privacy).toEqual({
					mode: "default",
					externalUrl: null,
				});
			}
		});

		it("disables privacy when PRIVACY_POLICY_DISABLED is truthy", () => {
			expect(
				resolveAppConfig({ PRIVACY_POLICY_DISABLED: "1" }).privacy,
			).toEqual({ mode: "disabled", externalUrl: null });
		});

		it("treats 1/true/yes/on (case-insensitive) as disabled", () => {
			for (const v of ["1", "true", "TRUE", "yes", "On"]) {
				expect(
					resolveAppConfig({ PRIVACY_POLICY_DISABLED: v }).privacy.mode,
				).toBe("disabled");
			}
		});

		it("treats other values as not-disabled", () => {
			for (const v of ["0", "false", "no", "off", ""]) {
				expect(
					resolveAppConfig({ PRIVACY_POLICY_DISABLED: v }).privacy.mode,
				).toBe("default");
			}
		});

		it("lets DISABLED win over a set URL", () => {
			expect(
				resolveAppConfig({
					PRIVACY_POLICY_URL: "https://acme.example/legal/privacy",
					PRIVACY_POLICY_DISABLED: "true",
				}).privacy,
			).toEqual({ mode: "disabled", externalUrl: null });
		});
	});
});

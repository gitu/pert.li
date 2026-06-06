import { describe, expect, it } from "vitest";
import { DEFAULT_APP_CONFIG, resolveAppConfig } from "#/lib/app-config";
import { buildManifest } from "./manifest";

describe("buildManifest", () => {
	it("uses the hosted defaults: short_name is the wordmark, name is the full tagline", () => {
		const manifest = buildManifest(DEFAULT_APP_CONFIG);
		expect(manifest.short_name).toBe("pert.li");
		expect(manifest.name).toBe("pert.li — collaborative PERT planning");
	});

	it("reflects a rebranded deployment (APP_NAME) in both name and short_name", () => {
		// APP_NAME alone makes resolveAppConfig derive the same appTitle, so both
		// the home-screen label and the full install name become the chosen name.
		const config = resolveAppConfig({ APP_NAME: "Acme Planner" });
		const manifest = buildManifest(config);
		expect(manifest.short_name).toBe("Acme Planner");
		expect(manifest.name).toBe("Acme Planner");
	});

	it("keeps short_name and name independent when APP_TITLE is also set", () => {
		const config = resolveAppConfig({
			APP_NAME: "Acme",
			APP_TITLE: "Acme — internal planning",
		});
		const manifest = buildManifest(config);
		expect(manifest.short_name).toBe("Acme");
		expect(manifest.name).toBe("Acme — internal planning");
	});

	it("uses an absolute icon path so it resolves regardless of the manifest URL", () => {
		const manifest = buildManifest(DEFAULT_APP_CONFIG);
		const icons = manifest.icons as Array<{ src: string }>;
		expect(icons[0].src).toBe("/favicon.svg");
	});

	it("preserves the static display/start_url/color fields", () => {
		const manifest = buildManifest(DEFAULT_APP_CONFIG);
		expect(manifest.start_url).toBe("/");
		expect(manifest.display).toBe("standalone");
		expect(manifest.theme_color).toBe("#18181b");
		expect(manifest.background_color).toBe("#fafafa");
	});
});

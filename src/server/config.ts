import { createServerFn } from "@tanstack/react-start";
import { type AppConfig, resolveAppConfig } from "#/lib/app-config";

// Resolves the white-label runtime config (brand title/name + privacy policy
// mode) from process.env on each request. Read at request time, NOT build time,
// so self-hosted deployments configure it via env vars without a rebuild.
//
//   APP_NAME, APP_TITLE                page title / wordmark
//   PRIVACY_POLICY_URL                 redirect /privacy to an external policy
//   PRIVACY_POLICY_DISABLED            drop the privacy policy entirely
export const getAppConfig = createServerFn({ method: "GET" }).handler(
	async (): Promise<AppConfig> => resolveAppConfig(process.env),
);

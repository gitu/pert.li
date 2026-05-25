import { createServerFn } from "@tanstack/react-start";
import { getOidcPublicInfo } from "#/lib/auth.server";

/** Returns the OIDC button metadata (id + label) if the deployment has it
 * configured, else null. Safe to call from unauthenticated routes — no secret
 * is included in the response. */
export const getOidcButton = createServerFn({ method: "GET" }).handler(
	async () => getOidcPublicInfo(),
);

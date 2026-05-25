import { createServerFn } from "@tanstack/react-start";

// Resolves the privacy policy target the UI should link to.
//
// On the default-hosted pert.li, both the cookie hint and footer links point
// at the built-in /privacy route. On-prem / white-label deployments often
// have their own legal team and existing policy URL; they set
// `PRIVACY_POLICY_URL` and the /privacy route redirects there instead of
// rendering our default copy.
export const getPrivacySettings = createServerFn({ method: "GET" }).handler(
	async () => {
		const externalUrl = process.env.PRIVACY_POLICY_URL?.trim();
		return {
			externalUrl: externalUrl && externalUrl.length > 0 ? externalUrl : null,
		};
	},
);

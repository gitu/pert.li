import { useEffect, useState } from "react";

// Gravatar accepts SHA-256 of a trimmed, lowercased email as the avatar key.
// Spec: https://docs.gravatar.com/api/avatars/hash/
async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function getGravatarUrl(
	email: string,
	size = 80,
): Promise<string> {
	const hash = await sha256Hex(email.trim().toLowerCase());
	// `d=404` so the request fails when no Gravatar is registered, letting the
	// <img onError> fall back to our own initials placeholder.
	return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}

export function useGravatarUrl(email: string | null | undefined, size = 80) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!email) {
			setUrl(null);
			return;
		}
		let cancelled = false;
		getGravatarUrl(email, size).then((u) => {
			if (!cancelled) setUrl(u);
		});
		return () => {
			cancelled = true;
		};
	}, [email, size]);
	return url;
}

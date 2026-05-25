import { UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useGravatarUrl } from "#/lib/gravatar";
import { cn } from "#/lib/utils";

export type UserAvatarProps = {
	name?: string | null;
	email: string;
	image?: string | null;
	size?: number;
	className?: string;
};

function initialsOf(name: string | null | undefined, email: string) {
	const source = name?.trim() || email;
	return source
		.split(/[\s@.]+/)
		.map((s) => s[0]?.toUpperCase())
		.filter(Boolean)
		.slice(0, 2)
		.join("");
}

// Renders user.image first, then falls back to a Gravatar lookup, then to
// initials (or a generic person icon if even the email is empty). The Gravatar
// request uses d=404 so a missing avatar surfaces an onError we can catch
// instead of returning a generic silhouette we couldn't distinguish from a
// real one.
export function UserAvatar({
	name,
	email,
	image,
	size = 28,
	className,
}: UserAvatarProps) {
	const gravatar = useGravatarUrl(email, size * 2);
	const candidate = image ?? gravatar ?? null;
	const [src, setSrc] = useState<string | null>(candidate);
	useEffect(() => {
		setSrc(candidate);
	}, [candidate]);

	const initials = initialsOf(name, email);

	return (
		<span
			className={cn(
				"grid place-items-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground",
				className,
			)}
			style={{ width: size, height: size }}
		>
			{src ? (
				<img
					src={src}
					alt={name ?? email}
					width={size}
					height={size}
					className="h-full w-full object-cover"
					onError={() => setSrc(null)}
				/>
			) : initials ? (
				<span>{initials}</span>
			) : (
				<UserIcon className="size-4" />
			)}
		</span>
	);
}

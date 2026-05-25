import { Link, useParams } from "@tanstack/react-router";
import {
	BotIcon,
	HistoryIcon,
	LayersIcon,
	LogOutIcon,
	MenuIcon,
	UserCogIcon,
} from "lucide-react";
import { UserAvatar } from "#/components/account/user-avatar";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { authClient } from "#/lib/auth-client";
import { chatDock, useChatDockMode } from "#/lib/chat-dock";

// Mobile top bar — the phone-shell equivalent of the desktop TopBar. Kept
// intentionally light: hamburger left, brand center, chat icon right, plus
// an overflow menu for the account actions. Phase 2 wires the History icon
// to a left Sheet; Phase 5 adds the edit-mode pencil between Chat and Menu.

type Props = {
	user: { name?: string | null; email: string; image?: string | null };
	onOpenProjects: () => void;
	onOpenHistory: () => void;
	onEditProfile: () => void;
};

export function MobileTopBar({
	user,
	onOpenProjects,
	onOpenHistory,
	onEditProfile,
}: Props) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const inProject = Boolean(params.projectId);

	return (
		<header className="flex h-12 shrink-0 items-center gap-1 border-b bg-card px-2">
			<Button
				type="button"
				size="icon"
				variant="ghost"
				className="size-9"
				onClick={onOpenProjects}
				aria-label="Open projects menu"
				data-testid="mobile-topbar-menu"
			>
				<MenuIcon className="size-5" />
			</Button>
			<Link to="/" className="flex items-center gap-1.5">
				<div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
					<LayersIcon className="size-4" />
				</div>
				<span className="text-sm font-semibold tracking-tight">pert.li</span>
			</Link>
			<div className="flex-1" />
			{inProject && (
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-9"
					onClick={onOpenHistory}
					aria-label="Project history"
					data-testid="mobile-topbar-history"
				>
					<HistoryIcon className="size-5" />
				</Button>
			)}
			<ChatTrigger />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="icon"
						variant="ghost"
						className="size-9"
						aria-label="Account menu"
					>
						<UserAvatar
							name={user.name}
							email={user.email}
							image={user.image}
							size={28}
						/>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-56">
					<DropdownMenuLabel className="font-normal">
						<div className="text-sm font-medium">{user.name ?? user.email}</div>
						<div className="text-xs text-muted-foreground">{user.email}</div>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={onEditProfile}>
						<UserCogIcon className="size-4" />
						Edit profile
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => void authClient.signOut()}>
						<LogOutIcon className="size-4" />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</header>
	);
}

function ChatTrigger() {
	const mode = useChatDockMode();
	return (
		<Button
			type="button"
			size="icon"
			variant={mode !== "closed" ? "secondary" : "ghost"}
			className="size-9"
			aria-label="Open chat"
			aria-pressed={mode !== "closed"}
			data-testid="mobile-topbar-chat"
			onClick={() => {
				if (mode === "closed") chatDock.openSheet();
				else chatDock.close();
			}}
		>
			<BotIcon className="size-5" />
		</Button>
	);
}

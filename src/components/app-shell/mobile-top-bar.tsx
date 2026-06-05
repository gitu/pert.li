import { Link, useParams } from "@tanstack/react-router";
import {
	BotIcon,
	EyeIcon,
	HistoryIcon,
	InfoIcon,
	LayersIcon,
	LogOutIcon,
	MenuIcon,
	PencilIcon,
	ShieldIcon,
	UserCogIcon,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { SyncNowItem } from "#/components/account/sync-now-item";
import { UserAvatar } from "#/components/account/user-avatar";
import { SyncStatus } from "#/components/sync/sync-status";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useAppConfig } from "#/lib/app-config";
import { signOutEverywhere } from "#/lib/auth/sign-out";
import { chatDock, useChatDockMode } from "#/lib/chat-dock";
import { useViewMode } from "#/lib/view-mode";

// Mobile top bar — the phone-shell equivalent of the desktop TopBar. Kept
// intentionally light: hamburger left, brand center, chat icon right, plus
// an overflow menu for the account actions. Phase 2 wires the History icon
// to a left Sheet; Phase 5 adds the edit-mode pencil between Chat and Menu.

type Props = {
	user: {
		name?: string | null;
		email: string;
		image?: string | null;
		isAdmin: boolean;
	};
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
	const { appName } = useAppConfig();

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
				<span className="text-sm font-semibold tracking-tight">{appName}</span>
			</Link>
			<div className="flex-1" />
			{inProject && <EditModeToggle />}
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
			{inProject && <ChatTrigger />}
			<SyncStatus />
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
					{user.isAdmin && (
						<DropdownMenuItem asChild>
							<Link to="/admin" data-testid="mobile-nav-admin">
								<ShieldIcon className="size-4" />
								Admin
							</Link>
						</DropdownMenuItem>
					)}
					<SyncNowItem />
					<DropdownMenuSeparator />
					<DropdownMenuItem asChild>
						<Link to="/about" data-testid="mobile-nav-about">
							<InfoIcon className="size-4" />
							About
						</Link>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => void signOutEverywhere()}>
						<LogOutIcon className="size-4" />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</header>
	);
}

function EditModeToggle() {
	const { mode, setEditing } = useViewMode();
	const editing = mode === "mobile-editing";
	// Show the "editing enabled" hint once per session so the user knows the
	// pencil flipped them into the same surface a desktop editor sees.
	const toastedRef = useRef(false);
	return (
		<Button
			type="button"
			size="icon"
			variant={editing ? "secondary" : "ghost"}
			className="size-9"
			onClick={() => {
				const next = !editing;
				setEditing(next);
				if (next && !toastedRef.current) {
					toastedRef.current = true;
					toast("Editing enabled — changes sync immediately.");
				}
			}}
			aria-label={editing ? "Stop editing" : "Enable editing"}
			aria-pressed={editing}
			data-testid="mobile-topbar-edit"
		>
			{editing ? (
				<EyeIcon className="size-5" />
			) : (
				<PencilIcon className="size-5" />
			)}
		</Button>
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

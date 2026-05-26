import { ShieldIcon } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { AdminStats, AdminUserRow } from "#/server/admin-store.server.ts";

type Props = {
	stats: AdminStats;
	users: AdminUserRow[];
};

const STAT_TILES: ReadonlyArray<{
	key: keyof AdminStats;
	label: string;
	hint: string;
}> = [
	{ key: "users", label: "Users", hint: "Registered accounts" },
	{ key: "admins", label: "Admins", hint: "Users with operator access" },
	{ key: "workspaces", label: "Workspaces", hint: "Personal + shared" },
	{ key: "projects", label: "Projects", hint: "Active, non-archived" },
	{
		key: "activeSessions",
		label: "Sessions",
		hint: "Live sign-in sessions",
	},
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "numeric",
});

export function AdminPanel({ stats, users }: Props) {
	return (
		<div
			className="mx-auto flex h-full max-w-5xl flex-col gap-8 overflow-y-auto p-10"
			data-testid="admin-panel"
		>
			<header className="flex items-center gap-3">
				<div className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
					<ShieldIcon className="size-5" />
				</div>
				<div>
					<h1 className="text-xl font-semibold tracking-tight">
						Admin overview
					</h1>
					<p className="text-sm text-muted-foreground">
						Operator-only view. No user content is shown — just counts and
						sign-up metadata.
					</p>
				</div>
			</header>

			<section
				aria-label="Instance statistics"
				className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
			>
				{STAT_TILES.map((tile) => (
					<div
						key={tile.key}
						className="rounded-lg border bg-card p-4"
						data-testid={`admin-stat-${tile.key}`}
					>
						<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{tile.label}
						</div>
						<div className="mt-1 text-2xl font-semibold tabular-nums">
							{stats[tile.key]}
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							{tile.hint}
						</div>
					</div>
				))}
			</section>

			<section aria-label="Users" className="rounded-lg border bg-card">
				<div className="flex items-center justify-between border-b px-4 py-3">
					<div>
						<h2 className="text-sm font-medium">Users</h2>
						<p className="text-xs text-muted-foreground">
							Sign-up order, name and email only. No project or activity data.
						</p>
					</div>
					<Badge variant="secondary">{users.length} total</Badge>
				</div>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Role</TableHead>
							<TableHead className="text-right">Joined</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{users.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={4}
									className="py-6 text-center text-sm text-muted-foreground"
								>
									No users yet.
								</TableCell>
							</TableRow>
						) : (
							users.map((u) => (
								<TableRow key={u.id} data-testid={`admin-user-${u.id}`}>
									<TableCell className="font-medium">
										{u.name || <span className="text-muted-foreground">—</span>}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{u.email}
									</TableCell>
									<TableCell>
										{u.isAdmin ? (
											<Badge className="gap-1">
												<ShieldIcon className="size-3" />
												Admin
											</Badge>
										) : (
											<Badge variant="outline">User</Badge>
										)}
									</TableCell>
									<TableCell className="text-right text-muted-foreground tabular-nums">
										{dateFormatter.format(new Date(u.createdAt))}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</section>
		</div>
	);
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Textarea } from "#/components/ui/textarea";
import { cn } from "#/lib/utils";
import {
	addProjectComment,
	deleteProjectComment,
	editProjectComment,
	listProjectComments,
} from "#/server/workspace";
import type { ProjectComment } from "#/types/workspace";

// Threaded discussion attached to a project (root or branch). On a branch,
// this is the natural place to talk about a what-if before deciding to
// merge — pre-merge review without forcing a chat thread. On a root project,
// it doubles as a notes/decisions log alongside the plan.
export type ProjectCommentsPanelProps = {
	projectId: string;
	currentUserId: string;
	className?: string;
};

export function ProjectCommentsPanel({
	projectId,
	currentUserId,
	className,
}: ProjectCommentsPanelProps) {
	const queryClient = useQueryClient();
	const queryKey = ["project-comments", projectId] as const;

	const { data, isLoading, error } = useQuery({
		queryKey,
		queryFn: () => listProjectComments({ data: { projectId } }),
	});

	const addMutation = useMutation({
		mutationFn: (body: string) =>
			addProjectComment({ data: { projectId, body } }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	const editMutation = useMutation({
		mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
			editProjectComment({ data: { commentId, body } }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	const deleteMutation = useMutation({
		mutationFn: (commentId: string) =>
			deleteProjectComment({ data: { commentId } }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	const [draft, setDraft] = useState("");
	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const body = draft.trim();
		if (!body) return;
		addMutation.mutate(body, { onSuccess: () => setDraft("") });
	};

	const comments: ProjectComment[] = data ?? [];

	return (
		<div
			className={cn("flex h-full flex-col bg-card", className)}
			data-testid="project-comments-panel"
		>
			<header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<MessageSquareIcon className="size-3.5" />
				Comments
				<span className="ml-auto text-[10px] text-muted-foreground">
					{comments.length}
				</span>
			</header>
			<ScrollArea className="min-h-0 flex-1">
				<ul className="space-y-3 px-3 py-3">
					{isLoading && (
						<li className="text-xs text-muted-foreground">Loading comments…</li>
					)}
					{error && (
						<li className="text-xs text-destructive" role="alert">
							Couldn't load comments.
						</li>
					)}
					{!isLoading && comments.length === 0 && (
						<li className="text-xs text-muted-foreground">
							No comments yet. Start a discussion about this plan.
						</li>
					)}
					{comments.map((c) => (
						<CommentRow
							key={c.id}
							comment={c}
							isAuthor={c.authorId === currentUserId}
							onEdit={(body) => editMutation.mutate({ commentId: c.id, body })}
							onDelete={() => deleteMutation.mutate(c.id)}
						/>
					))}
				</ul>
			</ScrollArea>
			<form
				onSubmit={submit}
				className="flex shrink-0 flex-col gap-2 border-t bg-background/40 px-3 py-3"
			>
				<Textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					placeholder="Add a comment…"
					rows={2}
					disabled={addMutation.isPending}
					data-testid="project-comments-input"
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							submit(e);
						}
					}}
				/>
				<div className="flex items-center justify-between">
					<span className="text-[10px] text-muted-foreground">
						⌘/Ctrl + Enter to post
					</span>
					<Button
						type="submit"
						size="sm"
						disabled={addMutation.isPending || draft.trim() === ""}
						data-testid="project-comments-submit"
					>
						{addMutation.isPending ? "Posting…" : "Post"}
					</Button>
				</div>
			</form>
		</div>
	);
}

function CommentRow({
	comment,
	isAuthor,
	onEdit,
	onDelete,
}: {
	comment: ProjectComment;
	isAuthor: boolean;
	onEdit: (body: string) => void;
	onDelete: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(comment.body);

	const save = () => {
		const next = draft.trim();
		if (next === "" || next === comment.body) {
			setEditing(false);
			setDraft(comment.body);
			return;
		}
		onEdit(next);
		setEditing(false);
	};

	return (
		<li
			className="rounded-md border border-border bg-background/60 p-2 text-xs"
			data-testid={`project-comment-${comment.id}`}
		>
			<div className="flex items-baseline justify-between gap-2">
				<div className="flex items-baseline gap-2">
					<span className="font-medium text-foreground">
						{comment.authorName}
					</span>
					<time
						className="text-[10px] text-muted-foreground"
						title={new Date(comment.createdAt).toLocaleString()}
					>
						{formatRelative(comment.createdAt)}
					</time>
					{comment.editedAt && (
						<span
							className="text-[10px] text-muted-foreground"
							title={`Edited ${new Date(comment.editedAt).toLocaleString()}`}
						>
							(edited)
						</span>
					)}
				</div>
				{isAuthor && !editing && (
					<div className="flex items-center gap-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-5 w-5 p-0"
							onClick={() => {
								setDraft(comment.body);
								setEditing(true);
							}}
							aria-label="Edit comment"
						>
							<PencilIcon className="size-3" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-5 w-5 p-0 text-destructive hover:bg-destructive/10"
							onClick={onDelete}
							aria-label="Delete comment"
						>
							<Trash2Icon className="size-3" />
						</Button>
					</div>
				)}
			</div>
			{editing ? (
				<div className="mt-2 space-y-2">
					<Textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						rows={2}
						data-testid={`project-comment-edit-${comment.id}`}
					/>
					<div className="flex gap-2">
						<Button type="button" size="sm" onClick={save}>
							Save
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => {
								setEditing(false);
								setDraft(comment.body);
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<p className="mt-1 whitespace-pre-wrap text-foreground">
					{comment.body}
				</p>
			)}
		</li>
	);
}

function formatRelative(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	if (ms < 0) return "just now";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 14) return `${d}d ago`;
	return new Date(iso).toLocaleDateString();
}

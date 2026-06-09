import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { buildIssueUrl } from "#/lib/pert/issue-tracker";
import { cn } from "#/lib/utils";

// Render a single issue key as a click-through link (when it resolves against
// the tracker template, or is itself a URL) or as plain text otherwise. Shared
// by the read-only list, the editor chips, and the compact badge.
function IssueChip({
	issueKey,
	template,
	className,
}: {
	issueKey: string;
	template?: string;
	className?: string;
}) {
	// Allowlist the protocol at the href sink itself, so a malicious tracker
	// template (the template lives in the shared doc) can't inject a
	// javascript:/data: URL that executes on click (CWE-79). buildIssueUrl
	// already restricts to http(s); this is the defense-in-depth guard right
	// where the value reaches the DOM.
	const candidate = buildIssueUrl(template, issueKey);
	let url: string | null = null;
	if (candidate) {
		try {
			const protocol = new URL(candidate).protocol;
			if (protocol === "http:" || protocol === "https:") url = candidate;
		} catch {
			url = null;
		}
	}
	if (url) {
		return (
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				data-testid="issue-link"
				className={cn(
					"inline-flex items-center gap-1 text-primary hover:underline",
					className,
				)}
				// Don't let a click bubble up to a parent node/row selection handler.
				onClick={(e) => e.stopPropagation()}
			>
				<ExternalLinkIcon className="size-3 shrink-0" />
				{issueKey}
			</a>
		);
	}
	return (
		<span
			data-testid="issue-text"
			className={cn(
				"inline-flex items-center text-muted-foreground",
				className,
			)}
		>
			{issueKey}
		</span>
	);
}

// Read-only display of a task's issue links. Renders nothing when there are no
// keys, so callers can drop it in unconditionally.
export function IssueLinkList({
	issueKeys,
	template,
	className,
}: {
	issueKeys: string[] | undefined;
	template?: string;
	className?: string;
}) {
	if (!issueKeys || issueKeys.length === 0) return null;
	return (
		<div
			data-testid="issue-link-list"
			className={cn("flex flex-wrap gap-x-3 gap-y-1 text-sm", className)}
		>
			{issueKeys.map((key) => (
				<IssueChip key={key} issueKey={key} template={template} />
			))}
		</div>
	);
}

// Compact badge for dense surfaces (table rows, canvas nodes): shows the first
// key as a link plus a "+N" overflow count. Renders nothing when empty.
export function IssueLinkBadge({
	issueKeys,
	template,
	className,
}: {
	issueKeys: string[] | undefined;
	template?: string;
	className?: string;
}) {
	if (!issueKeys || issueKeys.length === 0) return null;
	const [first, ...rest] = issueKeys;
	return (
		<span
			data-testid="issue-link-badge"
			className={cn("inline-flex items-center gap-1 text-xs", className)}
		>
			<IssueChip issueKey={first} template={template} />
			{rest.length > 0 && (
				<span className="text-muted-foreground">+{rest.length}</span>
			)}
		</span>
	);
}

// Editable list of issue keys. Whole-list semantics: every add/remove emits the
// complete next array via onChange (the caller cleans/dedupes when committing).
export function IssueLinksEditor({
	issueKeys,
	template,
	onChange,
	inputId,
}: {
	issueKeys: string[];
	template?: string;
	onChange: (next: string[]) => void;
	// Optional id for the add-key input, so a caller's <Label htmlFor> can
	// associate with it for screen readers / click-to-focus.
	inputId?: string;
}) {
	const [draft, setDraft] = useState("");

	const add = () => {
		const value = draft.trim();
		if (value === "") return;
		if (!issueKeys.includes(value)) onChange([...issueKeys, value]);
		setDraft("");
	};
	const remove = (key: string) => onChange(issueKeys.filter((k) => k !== key));

	return (
		<div className="space-y-2" data-testid="issue-links-editor">
			{issueKeys.length > 0 && (
				<ul className="flex flex-wrap gap-1.5">
					{issueKeys.map((key) => {
						const url = buildIssueUrl(template, key);
						return (
							<li
								key={key}
								className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-xs"
							>
								{url ? (
									<IssueChip issueKey={key} template={template} />
								) : (
									<span>{key}</span>
								)}
								<button
									type="button"
									onClick={() => remove(key)}
									aria-label={`Remove ${key}`}
									data-testid={`issue-link-remove-${key}`}
									className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								>
									<XIcon className="size-3" />
								</button>
							</li>
						);
					})}
				</ul>
			)}
			<div className="flex gap-1.5">
				<Input
					id={inputId}
					value={draft}
					data-testid="issue-link-input"
					placeholder="PROJ-123 or https://…"
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							add();
						}
					}}
				/>
				<Button
					type="button"
					variant="outline"
					data-testid="issue-link-add"
					disabled={draft.trim() === ""}
					onClick={add}
				>
					Add
				</Button>
			</div>
		</div>
	);
}

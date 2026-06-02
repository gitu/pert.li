import {
	AlertTriangleIcon,
	ArrowRightIcon,
	GitBranchIcon,
	GitMergeIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import type { ResolvedMergeChange } from "#/lib/ai/merge-to-ops";
import type { MergeChange, MergeSide } from "#/lib/pert/merge";
import { cn } from "#/lib/utils";

// Renders one row per MergeChange, surfacing the user's resolution control:
//  - clean rows (clean-from-branch, clean-add-from-branch, clean-remove-from-
//    branch): a single checkbox, default checked, meaning "take this from
//    branch." Unchecking flips resolution to "skip" (nothing applied).
//  - conflict rows: a 3-way picker — Take branch / Keep main / Skip. Defaults
//    to Keep main so applying without thinking never silently overwrites
//    main's progress. Add-vs-add conflicts surface the same picker on a
//    per-field row.
//
// The component is fully controlled: parent owns the `resolutions` map keyed
// by the row's stable id (which differs between field and entity rows; see
// `rowKey`).

export type MergeChangeListProps = {
	changes: MergeChange[];
	resolutions: Record<string, MergeSide>;
	onResolutionChange: (rowKey: string, side: MergeSide) => void;
};

export function rowKey(c: MergeChange): string {
	return c.kind === "field"
		? `${c.entity}:${c.id}:${c.field}`
		: `${c.entity}:${c.id}:__entity__`;
}

export function MergeChangeList({
	changes,
	resolutions,
	onResolutionChange,
}: MergeChangeListProps) {
	if (changes.length === 0) {
		return (
			<div
				className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground"
				data-testid="merge-change-list-empty"
			>
				<div>
					<GitMergeIcon
						className="mx-auto mb-2 size-6 text-muted-foreground"
						aria-hidden
					/>
					Nothing to merge — the branch and main are in sync.
				</div>
			</div>
		);
	}
	return (
		<ul className="divide-y divide-border" data-testid="merge-change-list">
			{changes.map((c) => {
				const key = rowKey(c);
				const resolution = resolutions[key] ?? c.suggestedSide;
				return (
					<li
						key={key}
						data-testid={`merge-row-${key}`}
						data-classification={c.classification}
						data-resolution={resolution}
						className={cn(
							"px-3 py-2 text-xs",
							isConflict(c) && "bg-amber-500/[0.04]",
						)}
					>
						<MergeRow
							change={c}
							resolution={resolution}
							onChange={(side) => onResolutionChange(key, side)}
						/>
					</li>
				);
			})}
		</ul>
	);
}

function MergeRow({
	change,
	resolution,
	onChange,
}: {
	change: MergeChange;
	resolution: MergeSide;
	onChange: (side: MergeSide) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<RowHeader change={change} />
			<RowBody change={change} resolution={resolution} onChange={onChange} />
		</div>
	);
}

function RowHeader({ change }: { change: MergeChange }) {
	return (
		<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
			<EntityIcon change={change} />
			<span className="font-medium text-foreground">{change.label}</span>
			{change.kind === "field" && (
				<span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
					{change.field}
				</span>
			)}
			{isConflict(change) && (
				<span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-700">
					<AlertTriangleIcon className="size-3" />
					{conflictLabel(change.classification)}
				</span>
			)}
		</div>
	);
}

function EntityIcon({ change }: { change: MergeChange }) {
	if (change.kind !== "entity") {
		return (
			<span
				className="size-3 rounded-sm border border-border bg-card"
				aria-hidden
			/>
		);
	}
	if (change.classification === "clean-add-from-branch") {
		return <PlusIcon className="size-3 text-primary" aria-hidden />;
	}
	if (
		change.classification === "clean-remove-from-branch" ||
		change.classification === "conflict-removed-vs-modified"
	) {
		return <Trash2Icon className="size-3 text-destructive" aria-hidden />;
	}
	return <GitBranchIcon className="size-3 text-primary" aria-hidden />;
}

function RowBody({
	change,
	resolution,
	onChange,
}: {
	change: MergeChange;
	resolution: MergeSide;
	onChange: (side: MergeSide) => void;
}) {
	if (change.kind === "field") {
		if (change.classification === "clean-from-branch") {
			return (
				<CleanFieldControl
					branch={change.branch}
					main={change.main}
					resolution={resolution}
					onChange={onChange}
				/>
			);
		}
		return (
			<ConflictPicker
				main={renderValue(change.main)}
				branch={renderValue(change.branch)}
				resolution={resolution}
				onChange={onChange}
			/>
		);
	}
	if (change.classification === "clean-add-from-branch") {
		return (
			<CleanEntityControl
				summary={`Add to main: ${change.label}`}
				resolution={resolution}
				onChange={onChange}
			/>
		);
	}
	if (change.classification === "clean-remove-from-branch") {
		return (
			<CleanEntityControl
				summary={`Remove from main: ${change.label}`}
				resolution={resolution}
				onChange={onChange}
			/>
		);
	}
	// Conflicting entity-level rows.
	const main =
		change.classification === "conflict-removed-vs-modified"
			? "Main keeps the modified entity"
			: "Main has already removed it";
	const branch =
		change.classification === "conflict-removed-vs-modified"
			? "Branch removes the entity"
			: "Branch keeps modified version";
	return (
		<ConflictPicker
			main={main}
			branch={branch}
			resolution={resolution}
			onChange={onChange}
		/>
	);
}

function CleanFieldControl({
	branch,
	main,
	resolution,
	onChange,
}: {
	branch: unknown;
	main: unknown;
	resolution: MergeSide;
	onChange: (side: MergeSide) => void;
}) {
	const include = resolution === "branch";
	return (
		<label className="flex flex-wrap items-center gap-2 text-[11px]">
			<input
				type="checkbox"
				className="size-3.5 accent-primary"
				checked={include}
				onChange={(e) => onChange(e.target.checked ? "branch" : "skip")}
				data-testid="merge-row-clean-checkbox"
			/>
			<span className="text-muted-foreground">From</span>
			<ValueChip value={main} tone="muted" />
			<ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden />
			<ValueChip value={branch} tone="branch" />
		</label>
	);
}

function CleanEntityControl({
	summary,
	resolution,
	onChange,
}: {
	summary: string;
	resolution: MergeSide;
	onChange: (side: MergeSide) => void;
}) {
	const include = resolution === "branch";
	return (
		<label className="flex items-center gap-2 text-[11px]">
			<input
				type="checkbox"
				className="size-3.5 accent-primary"
				checked={include}
				onChange={(e) => onChange(e.target.checked ? "branch" : "skip")}
				data-testid="merge-row-clean-checkbox"
			/>
			<span className="text-foreground">{summary}</span>
		</label>
	);
}

function ConflictPicker({
	main,
	branch,
	resolution,
	onChange,
}: {
	main: React.ReactNode;
	branch: React.ReactNode;
	resolution: MergeSide;
	onChange: (side: MergeSide) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="grid grid-cols-2 gap-2 text-[11px]">
				<SidePreview label="Main" value={main} active={resolution === "main"} />
				<SidePreview
					label="Branch"
					value={branch}
					active={resolution === "branch"}
				/>
			</div>
			<div className="flex flex-wrap gap-1.5">
				<PickerButton
					testId="merge-row-pick-main"
					label="Keep main"
					active={resolution === "main"}
					onClick={() => onChange("main")}
				/>
				<PickerButton
					testId="merge-row-pick-branch"
					label="Take branch"
					active={resolution === "branch"}
					onClick={() => onChange("branch")}
				/>
				<PickerButton
					testId="merge-row-pick-skip"
					label="Skip"
					active={resolution === "skip"}
					onClick={() => onChange("skip")}
				/>
			</div>
		</div>
	);
}

function SidePreview({
	label,
	value,
	active,
}: {
	label: string;
	value: React.ReactNode;
	active: boolean;
}) {
	return (
		<div
			className={cn(
				"rounded-md border bg-card p-1.5",
				active ? "border-primary" : "border-border",
			)}
		>
			<div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="break-words text-[11px] text-foreground">{value}</div>
		</div>
	);
}

function PickerButton({
	label,
	active,
	onClick,
	testId,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
	testId: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			data-testid={testId}
			aria-pressed={active}
			className={cn(
				"rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors",
				active
					? "border-transparent bg-primary text-primary-foreground"
					: "border-border bg-card text-muted-foreground hover:bg-accent/40",
			)}
		>
			{label}
		</button>
	);
}

function ValueChip({
	value,
	tone,
}: {
	value: unknown;
	tone: "muted" | "branch";
}) {
	return (
		<span
			className={cn(
				"rounded border px-1 py-0.5 text-[10px]",
				tone === "muted"
					? "border-border bg-card text-muted-foreground"
					: "border-primary/30 bg-primary/10 text-primary",
			)}
		>
			{renderValue(value)}
		</span>
	);
}

function isConflict(change: MergeChange): boolean {
	return change.classification.startsWith("conflict");
}

function conflictLabel(classification: MergeChange["classification"]): string {
	switch (classification) {
		case "conflict-modified":
			return "Both edited";
		case "conflict-add-vs-add":
			return "Added on both sides";
		case "conflict-removed-vs-modified":
			return "Removed vs. modified";
		case "conflict-modified-vs-removed":
			return "Modified vs. removed";
		default:
			return "Conflict";
	}
}

function renderValue(value: unknown): string {
	if (value === undefined) return "—";
	if (value === null) return "∅";
	if (typeof value === "string") return value === "" ? "(empty)" : value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserialisable]";
	}
}

// Re-exported for callers that need the same type when wiring resolution
// state — keeps the import surface area tight.
export type { ResolvedMergeChange };

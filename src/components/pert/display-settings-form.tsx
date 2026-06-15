import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { SheetFooter } from "#/components/ui/sheet";
import type { DisplayFormResult } from "#/lib/pert/apply-display";
import {
	CANVAS_FIELDS,
	type FieldDef,
	OVERVIEW_FIELDS,
	type ResolvedDisplaySettings,
} from "#/lib/pert/display";

// DISPLAY-SETTINGS: editor for the per-project display config. Two surfaces
// (Overview groups list + Network canvas nodes), each a density MODE plus a
// per-field visibility checklist. Self-contained — captures `initial` at mount,
// so the parent gets "re-seed from props" for free by bumping the key after a
// Save/Cancel. Emits the full layout+fields payload via onSave; the mutator
// (apply-display.ts) distils it to the sparse on-doc form.

const LAYOUT_MODES = [
	{ value: "detailed" as const, label: "Detailed" },
	{ value: "compact" as const, label: "Compact" },
];

export function DisplaySettingsForm({
	initial,
	onCancel,
	onSave,
	// When provided, renders a "Copy to other projects…" action that hands the
	// CURRENT (on-screen) settings up to the container to fan out. Omitted in
	// read-only mode or when the user has no other projects.
	onCopyToProjects,
}: {
	initial: ResolvedDisplaySettings;
	onCancel: () => void;
	onSave: (next: DisplayFormResult) => void;
	onCopyToProjects?: (current: DisplayFormResult) => void;
}) {
	const [overviewLayout, setOverviewLayout] = useState(initial.overview.layout);
	const [overviewFields, setOverviewFields] = useState<Record<string, boolean>>(
		initial.overview.fields,
	);
	const [canvasLayout, setCanvasLayout] = useState(initial.canvas.layout);
	const [canvasFields, setCanvasFields] = useState<Record<string, boolean>>(
		initial.canvas.fields,
	);

	const current: DisplayFormResult = {
		overview: { layout: overviewLayout, fields: overviewFields },
		canvas: { layout: canvasLayout, fields: canvasFields },
	};

	const dirty =
		overviewLayout !== initial.overview.layout ||
		canvasLayout !== initial.canvas.layout ||
		!sameFields(overviewFields, initial.overview.fields) ||
		!sameFields(canvasFields, initial.canvas.fields);

	return (
		<>
			<div className="space-y-5 p-4" data-testid="display-settings-form">
				<Surface
					surface="overview"
					title="Overview groups"
					hint="The Groups list on this page."
					fields={OVERVIEW_FIELDS}
					layout={overviewLayout}
					onLayout={setOverviewLayout}
					values={overviewFields}
					onToggle={(id, on) =>
						setOverviewFields((prev) => ({ ...prev, [id]: on }))
					}
				/>
				<Surface
					surface="canvas"
					title="Network nodes"
					hint="The task cards on the Network canvas."
					fields={CANVAS_FIELDS}
					layout={canvasLayout}
					onLayout={setCanvasLayout}
					values={canvasFields}
					onToggle={(id, on) =>
						setCanvasFields((prev) => ({ ...prev, [id]: on }))
					}
				/>

				{onCopyToProjects && (
					<div className="border-t pt-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-8 gap-1.5 text-xs"
							data-testid="display-copy-open"
							onClick={() => onCopyToProjects(current)}
						>
							<CopyIcon className="size-3.5" />
							Copy to other projects…
						</Button>
						<p className="mt-1.5 text-xs text-muted-foreground">
							Apply the settings shown above to other projects in this
							workspace.
						</p>
					</div>
				)}
			</div>
			<SheetFooter>
				{dirty ? (
					<span
						className="mr-auto inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500"
						data-testid="display-dirty"
					>
						<span className="size-1.5 rounded-full bg-amber-500" />
						Unsaved changes
					</span>
				) : (
					<span
						className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"
						data-testid="display-clean"
					>
						<CheckIcon className="size-3.5" />
						All changes saved
					</span>
				)}
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					data-testid="display-save"
					onClick={() => onSave(current)}
				>
					Save
				</Button>
			</SheetFooter>
		</>
	);
}

function Surface({
	surface,
	title,
	hint,
	fields,
	layout,
	onLayout,
	values,
	onToggle,
}: {
	surface: "overview" | "canvas";
	title: string;
	hint: string;
	fields: readonly FieldDef<string>[];
	layout: "compact" | "detailed";
	onLayout: (next: "compact" | "detailed") => void;
	values: Record<string, boolean>;
	onToggle: (id: string, on: boolean) => void;
}) {
	return (
		<div className="space-y-2.5">
			<div>
				<Label className="text-sm">{title}</Label>
				<p className="text-xs text-muted-foreground">{hint}</p>
			</div>
			<div className="inline-flex w-full rounded-md border bg-background p-0.5">
				{LAYOUT_MODES.map((m) => (
					<ModeButton
						key={m.value}
						active={layout === m.value}
						onClick={() => onLayout(m.value)}
						label={m.label}
						testid={`display-${surface}-mode-${m.value}`}
					/>
				))}
			</div>
			<ul className="space-y-1.5">
				{fields.map((f) => {
					const on = values[f.id] ?? f.defaultOn;
					return (
						<li key={f.id}>
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={on}
									data-testid={`display-${surface}-field-${f.id}`}
									onChange={(e) => onToggle(f.id, e.target.checked)}
									className="size-3.5 rounded border"
								/>
								{f.label}
							</label>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function ModeButton({
	active,
	onClick,
	label,
	testid,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	testid: string;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={onClick}
			aria-pressed={active}
			className={
				active
					? "flex-1 rounded bg-foreground px-2 py-1 text-xs font-medium text-background"
					: "flex-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
			}
		>
			{label}
		</button>
	);
}

// Shallow field-map equality over the union of keys.
function sameFields(
	a: Record<string, boolean>,
	b: Record<string, boolean>,
): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const k of keys) {
		if (a[k] !== b[k]) return false;
	}
	return true;
}

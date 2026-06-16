// Domain model for nested PERT projects. Lives inside an Automerge document.
//
// Shape rules (see vision.md §"Synchronization and conflict handling"):
//  - All collections are keyed maps, not arrays, to minimise concurrent-write
//    contention. Arrays are reserved for places where ORDER itself is semantic.
//  - The doc holds CONTENT only. Derived analytics (CPM ES/EF/slack, MC P90)
//    are computed from the doc and never written back to it.
//  - Per-user view state (collapse, selection, last-opened) belongs in the
//    workspace doc, not here.

export type TaskId = string;
export type DependencyId = string;
export type GroupId = string;
export type ViewId = string;

export type EstimateUnit = "hour" | "day" | "week";

export type Estimate = {
	optimistic: number;
	mostLikely: number;
	pessimistic: number;
	unit: EstimateUnit;
};

// Tasks are the schedulable leaves of a project. A `milestone` is a zero-
// duration marker; a `task` carries an estimate. Organisation (nesting,
// rollups, the collapsible boxes on the canvas) is owned by Groups — see
// `Group` below — which tasks join via `groupId`.
export type TaskKind = "task" | "milestone";

export type Layout = {
	position?: { x: number; y: number };
	// Manual size override. When set, the stored value becomes the minimum the
	// node/group is rendered at — members can still grow a group if they
	// overflow its bounding box.
	width?: number;
	height?: number;
};

// A "group" is a first-class organising container. Groups give structure that
// tasks themselves don't carry:
//   1. NAME      — a human label ("Milestone 1", "Backend").
//   2. HIERARCHY — groups nest via `parentGroupId`; tasks join via `groupId`.
//   3. NUMBERING — a group seeds the WBS number of its members ("1" → "1.1").
//   4. CANVAS    — it renders as a collapsible box that rolls up its members'
//                  schedule stats when collapsed.
// Groups may be empty. Collapse state is per-user (client-local), NOT stored
// here. The auto WBS number is DERIVED (see numbering.ts), never written back.
export type Group = {
	id: GroupId;
	name: string;
	// null/absent = a root (top-level) group.
	parentGroupId: GroupId | null;
	// Sibling ordering. Automerge keyed maps don't preserve insertion order
	// across merges, so numbering/layout sort by `(order, id)`.
	order: number;
	// Canvas box geometry. The anchor for empty/collapsed groups that have no
	// members to derive a bounding box from.
	layout?: Layout;
};

// "not_started" is the default for any task without an explicit status. We do
// NOT default-write it into the doc — absence == not_started — so old docs
// remain unchanged until the user touches them.
export type TaskStatus = "not_started" | "in_progress" | "completed";

// Progress is a percentage in [0, 100]. The engine clamps and treats it as a
// fraction of the task's expected duration that has been burned down. We only
// honour `progress` while `status === "in_progress"`; not_started == 0, and
// completed == 100, regardless of what the field stores.
export type Task = {
	id: TaskId;
	kind: TaskKind;
	title: string;
	// The group this task belongs to, or null/unset = ungrouped. Drives the
	// task's WBS number, its canvas box membership, and view grouping.
	groupId?: GroupId | null;
	// Ordering among siblings within a group. Drives the WBS member index
	// ("1.1" vs "1.2"). Sorted by `(order, id)`; absent = 0. Optional so the
	// many task-creation paths don't all have to set it (id breaks ties).
	order?: number;
	// Manual WBS-number override. When set, it wins over the derived number
	// (see numbering.ts) and "sticks" across group moves. Absence = use the
	// auto number. This is the ONLY number-related field stored on the doc —
	// the auto value is always derived, never written back.
	numberOverride?: string;
	estimate?: Estimate;
	notes?: string;
	// External issue references (e.g. Jira keys like "PROJ-123", or full URLs).
	// Rendered as clickable links via `doc.issueTracker.urlTemplate` (see
	// `buildIssueUrl`). Old docs predate this field — always optional.
	issueKeys?: string[];
	layout?: Layout;
	status?: TaskStatus;
	progress?: number;
	// ISO yyyy-mm-dd strings. Set when the user marks started/completed so we
	// can render actual dates alongside the planned ES/EF. The engine ignores
	// these for scheduling math — they are purely descriptive.
	actualStart?: string;
	actualFinish?: string;
	metadata?: {
		confidence?: number;
		tags?: string[];
		sourceRefs?: Array<{
			documentId: string;
			page?: number;
			paragraph?: number;
			excerptHash?: string;
		}>;
	};
};

export type DependencyPort = "start" | "finish";

// A dependency endpoint identifies a canonical task by `taskId`. When that
// task sits inside a collapsed group, the projection layer reroutes the edge
// to the group's box — the canonical `taskId` stays the truth.
export type DependencyEndpoint = {
	taskId?: TaskId;
	port?: DependencyPort;
};

export type DependencyType =
	| "finish_to_start"
	| "start_to_start"
	| "finish_to_finish"
	| "start_to_finish";

export type Dependency = {
	id: DependencyId;
	from: DependencyEndpoint;
	to: DependencyEndpoint;
	type: DependencyType;
	// Optional lag in `Estimate.unit`-agnostic days. Negative = lead.
	lagDays?: number;
};

export type ViewKind = "network" | "timeline" | "table" | "matrix";

export type ViewState = {
	id: ViewId;
	kind: ViewKind;
	label?: string;
};

// Per-project calendar. Drives ES/EF→date rendering and working-day math.
// `workingDays` uses ISO weekdays: 1=Mon … 7=Sun. Default is Mon–Fri.
// `holidays` are ISO yyyy-mm-dd dates always treated as non-working.
//
// `team` + `allocationMode` add a "team capacity" scheduling variant. When
// allocationMode === "team", computeSchedule stretches each task's duration by
// `peers / capacityPerDay` (peers = max concurrent overlap from a baseline
// CPM pass), modelling the worst-case "equal allocation across all open tasks,
// nobody prioritising the critical path" scenario.

// How the engine reads a task's three-point estimate when team capacity is on.
//   • "effort"   — the estimate is person-days of WORK. A task always divides by
//                  capacity, so a lone task with half a person takes 2× as long
//                  (E·peers / capacity). This is the original behaviour.
//   • "duration" — the estimate is the calendar DURATION one assignee achieves.
//                  Capacity caps how many tasks run in parallel, but a lone task
//                  (no concurrent peers) keeps its estimate regardless of how
//                  small the team is. Only genuine over-subscription stretches it.
export type EstimateBasis = "effort" | "duration";

export type TeamCapacity = {
	peopleCount: number;
	// Average % availability per person (0–100). 100 = every person works a
	// full working day on project tasks; 50 = each person gives half a day.
	availabilityPct: number;
	// When true and the project has completed tasks with actualStart/Finish
	// timestamps, the engine overrides `peopleCount × availabilityPct` with
	// the observed PD/day derived from history. Falls back to the configured
	// value when no usable history is available.
	useHistoric?: boolean;
	// Whether estimates are person-days of effort or calendar durations. Absent
	// = "effort" (the original semantics) so existing docs are unaffected.
	estimateBasis?: EstimateBasis;
};

export type AllocationMode = "calendar" | "team";

export type ProjectCalendar = {
	startDate: string;
	workingDays: number[];
	holidays?: string[];
	team?: TeamCapacity;
	allocationMode?: AllocationMode;
};

// ── Display settings ─────────────────────────────────────────────────────────
// DISPLAY-SETTINGS: per-project, collaborator-shared view config for the two
// surfaces that render rolled-up / per-task fields — the Overview "Groups"
// section and the Network canvas task nodes. Each surface picks a density MODE
// plus a SPARSE map of field-id → visible (absence = the field's registry
// default, so the doc stays small and merge-friendly, and newly-added registry
// fields default-on for existing docs without a migration). Stored on the doc
// (shared), NOT in the workspace doc or localStorage. Old docs predate this —
// always read through `resolveDisplaySettings(doc)` (display.ts), never branch
// on raw `doc.display`.
export type OverviewLayoutMode = "compact" | "detailed";
export type CanvasLayoutMode = "compact" | "detailed";

export type DisplaySurfaceSettings<Mode extends string> = {
	layout?: Mode;
	// Plain string keys (Automerge stores them as-is). The FieldId unions and
	// defaults live in display.ts; the doc type stays loose/forward-compatible.
	fields?: Record<string, boolean>;
};

export type DisplaySettings = {
	overview?: DisplaySurfaceSettings<OverviewLayoutMode>;
	canvas?: DisplaySurfaceSettings<CanvasLayoutMode>;
};

// Project-level external issue tracker config. `urlTemplate` carries a `{key}`
// placeholder substituted with a task's issue key to build a clickable link
// (e.g. "https://acme.atlassian.net/browse/{key}"). `name` is an optional label
// for the tracker (e.g. "Jira"). Old docs predate this — always optional.
export type ProjectIssueTracker = {
	urlTemplate: string;
	name?: string;
};

// ── Work plan ────────────────────────────────────────────────────────────────
// A structured, AI-driven todo list for large multi-step changes (bulk
// imports, restructurings). The assistant drafts it, the USER approves it
// (the approval is the review gate — once approved, steps apply directly to
// the doc), and then the assistant executes step by step. Living in the doc
// makes it collaborative: everyone in the project sees the same plan and its
// progress, and it survives reloads/devices.
//
// Lifecycle: draft → (user clicks Approve) → approved → executing → completed.
// "cancelled" is reachable from any non-terminal state. Old docs predate this
// field — always read with `doc.workPlan ?? undefined` semantics.

export type WorkPlanStepStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed"
	| "skipped";

export type WorkPlanStep = {
	id: string;
	title: string;
	// What this step should accomplish, written so it can be executed without
	// re-reading the source documents (the chat transcript may be gone).
	description: string;
	status: WorkPlanStepStatus;
	// Filled in as the step completes: what was created, or why it failed.
	result?: string;
};

export type WorkPlanStatus =
	| "draft"
	| "approved"
	| "executing"
	| "completed"
	| "cancelled";

export type WorkPlan = {
	id: string;
	title: string;
	// Why this plan exists (e.g. "Import the attached roadmap document").
	rationale: string;
	// Ordered list — order IS semantic here (execution sequence), which is the
	// one case the doc shape rules allow arrays for.
	steps: WorkPlanStep[];
	status: WorkPlanStatus;
	createdAt: number;
	updatedAt: number;
};

// Doc-scoped metadata that doesn't fit anywhere else. Today it only holds the
// actor → user registry used by the History drawer to render friendly names;
// callers must always read with `?? {}` since old docs predate this field.
export type DocMeta = {
	// Map keyed by Automerge actor id → who that actor belongs to. Set once
	// per actor at session start (see `useActorRegistration`). CRDT-friendly:
	// concurrent writes only ever add new keys; we never mutate an entry.
	actors?: Record<
		string,
		{ userId: string; name: string; firstSeenAt: number }
	>;
};

export type DocumentId = string;

// Mirrors `ExtractKind` from `src/lib/ai/file-extract.ts` — the kind of source
// the text was extracted from.
export type ProjectDocumentKind = "text" | "pdf" | "docx";

// A source document the user attached to the project (a spec, brief, roadmap…).
// We persist the *extracted plain text*, not the original binary: it's what the
// assistant reads, it's already bounded by file-extract's 200KB cap, and it
// keeps the doc self-contained and re-referenceable without any blob storage.
// `sourceRefs.documentId` on a Task points back here.
export type ProjectDocument = {
	id: DocumentId;
	// Original filename, shown to the user and the assistant.
	name: string;
	kind: ProjectDocumentKind;
	// Extracted text, already capped/truncated by file-extract's `truncate()`.
	text: string;
	// PDF page count, when known.
	pages?: number;
	// True when `text` was cut to fit the extraction cap.
	truncated: boolean;
	// Epoch ms when the document was attached.
	addedAt: number;
};

export type PertDoc = {
	schemaVersion: 1;
	title: string;
	tasksById: Record<TaskId, Task>;
	groupsById: Record<GroupId, Group>;
	dependenciesById: Record<DependencyId, Dependency>;
	viewsById: Record<ViewId, ViewState>;
	calendar?: ProjectCalendar;
	// DISPLAY-SETTINGS: shared per-project display config (which fields + which
	// density) for the Overview groups list and the canvas task nodes. Old docs
	// predate it — read through resolveDisplaySettings(), which fills defaults.
	display?: DisplaySettings;
	// External issue tracker config (URL template). Old docs predate this field
	// — always read defensively.
	issueTracker?: ProjectIssueTracker;
	meta?: DocMeta;
	// The active AI work plan, if any. One per project — creating a new plan
	// replaces the old one (prior plans remain in Automerge history).
	workPlan?: WorkPlan;
	// Source documents attached to the project (typically at "Describe with AI"
	// creation). Old docs predate this field — always read with
	// `doc.documentsById ?? {}`.
	documentsById?: Record<DocumentId, ProjectDocument>;
};

export function createEmptyPertDoc(title: string): PertDoc {
	return {
		schemaVersion: 1,
		title,
		tasksById: {},
		groupsById: {},
		dependenciesById: {},
		viewsById: {},
	};
}

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
export type InterfaceId = string;
export type ViewId = string;

export type EstimateUnit = "hour" | "day" | "week";

export type Estimate = {
	optimistic: number;
	mostLikely: number;
	pessimistic: number;
	unit: EstimateUnit;
};

// A "container" is a task that owns three orthogonal concerns:
//   1. HIERARCHY — it can have children (other tasks point to it via parentId).
//   2. BOUNDARY  — it exposes named interface ports (see ContainerInterface),
//                  which cross-boundary edges may route through when the
//                  container is collapsed.
//   3. COLLAPSE  — its visual projection can be folded into a single card.
// The model keeps all three under one `kind` because they almost always
// travel together; the inspector surfaces each concern as a separate section.
export type TaskKind = "task" | "milestone" | "container";

export type Layout = {
	position?: { x: number; y: number };
	collapsed?: boolean;
	// Manual size override. When unset, container nodes auto-fit to their
	// descendants' bounding box (expanded) or to the port rail height
	// (collapsed). When set, the stored value becomes the minimum the
	// container is rendered at — descendants can still grow it if they
	// overflow.
	width?: number;
	height?: number;
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
	parentId: TaskId | null;
	// Semantic grouping key, dotted-segment ("M1.A", "T.foo.bar"). Purely
	// for grouping in views — NOT a dependency or hierarchy in the scheduler.
	// Empty / unset = ungrouped.
	key?: string;
	estimate?: Estimate;
	notes?: string;
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

// A dependency endpoint always identifies a canonical descendant task by
// `taskId`. `interfaceId` is an *optional hint* used by the projection layer
// when the endpoint sits inside a collapsed container — it pins the edge to
// the named interface handle on the container card instead of routing to the
// container as a whole. Hint-only means the graph stays sound if an interface
// is renamed or removed: the canonical `taskId` is still the truth.
export type DependencyEndpoint = {
	taskId?: TaskId;
	interfaceId?: InterfaceId;
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

export type InterfaceKind = "entry" | "exit";

// A named port on a container's boundary. `taskRef` optionally pins the
// interface to a specific descendant — when set, the projection can use the
// (interface, taskRef) pairing to disambiguate which descendant a collapsed
// edge represents. When `taskRef` is unset, the interface is a generic port
// the user has authored but not bound yet.
//
// Every container gets a default Entry and a default Exit at creation; these
// have no `taskRef` and serve as the fall-through routing target for
// cross-boundary edges that don't pin an interface explicitly.
export type ContainerInterface = {
	id: InterfaceId;
	containerId: TaskId;
	kind: InterfaceKind;
	label: string;
	taskRef?: TaskId;
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
};

export type AllocationMode = "calendar" | "team";

export type ProjectCalendar = {
	startDate: string;
	workingDays: number[];
	holidays?: string[];
	team?: TeamCapacity;
	allocationMode?: AllocationMode;
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

export type PertDoc = {
	schemaVersion: 1;
	title: string;
	tasksById: Record<TaskId, Task>;
	dependenciesById: Record<DependencyId, Dependency>;
	interfacesByContainerId: Record<
		TaskId,
		Record<InterfaceId, ContainerInterface>
	>;
	viewsById: Record<ViewId, ViewState>;
	calendar?: ProjectCalendar;
	meta?: DocMeta;
};

export function createEmptyPertDoc(title: string): PertDoc {
	return {
		schemaVersion: 1,
		title,
		tasksById: {},
		dependenciesById: {},
		interfacesByContainerId: {},
		viewsById: {},
	};
}

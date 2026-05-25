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

export type TaskKind = "task" | "milestone" | "container";

export type Layout = {
	position?: { x: number; y: number };
	collapsed?: boolean;
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

export type ContainerInterface = {
	id: InterfaceId;
	containerId: TaskId;
	kind: InterfaceKind;
	label: string;
	// The descendant task this interface routes to/from. May be unset while
	// the user is still wiring things up.
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

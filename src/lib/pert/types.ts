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

export type Task = {
	id: TaskId;
	kind: TaskKind;
	title: string;
	parentId: TaskId | null;
	estimate?: Estimate;
	notes?: string;
	layout?: Layout;
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

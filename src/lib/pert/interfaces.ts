import type {
	ContainerInterface,
	InterfaceId,
	InterfaceKind,
	PertDoc,
	TaskId,
} from "./types";

// Container interfaces are named ports on a container's boundary. They are the
// vocabulary used to route cross-boundary edges when a container is collapsed:
// instead of an external edge collapsing to "the container as a whole", it
// collapses to a specific interface on the container card. The descendant task
// is still the canonical target — interfaces are a hint, not a redirection.
//
// Default vocabulary: every container has one default entry and one default
// exit. The vast majority of containers never grow beyond those two. Users who
// want fan-in or fan-out boundaries add more interfaces explicitly.

export function newInterfaceId(): InterfaceId {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `if_${s}`;
}

export function createDefaultInterface(
	containerId: TaskId,
	kind: InterfaceKind,
	id: InterfaceId = newInterfaceId(),
): ContainerInterface {
	return {
		id,
		containerId,
		kind,
		label: kind === "entry" ? "Entry" : "Exit",
	};
}

// Idempotent backfill: if the container has no interfaces of a given kind,
// adds a default one. Safe to call repeatedly (including on docs that have
// custom interfaces — we only add defaults when the kind is missing entirely).
export function ensureContainerInterfaces(
	doc: PertDoc,
	containerId: TaskId,
): void {
	if (!doc.interfacesByContainerId[containerId]) {
		doc.interfacesByContainerId[containerId] = {};
	}
	const bucket = doc.interfacesByContainerId[containerId];
	const kinds = new Set<InterfaceKind>();
	for (const iface of Object.values(bucket)) kinds.add(iface.kind);
	if (!kinds.has("entry")) {
		const entry = createDefaultInterface(containerId, "entry");
		bucket[entry.id] = entry;
	}
	if (!kinds.has("exit")) {
		const exit = createDefaultInterface(containerId, "exit");
		bucket[exit.id] = exit;
	}
}

// Drops the container's interface bucket. Called when a container is deleted
// or converted to a non-container kind. Dependencies that referenced these
// interfaces keep their canonical `taskId` endpoint — the orphaned
// `interfaceId` hint is left in place and ignored by the projection.
export function removeContainerInterfaces(
	doc: PertDoc,
	containerId: TaskId,
): void {
	delete doc.interfacesByContainerId[containerId];
}

export function getInterfacesFor(
	doc: PertDoc,
	containerId: TaskId,
): ContainerInterface[] {
	const bucket = doc.interfacesByContainerId[containerId];
	if (!bucket) return [];
	return Object.values(bucket);
}

// Returns the "primary" interface of a given kind for a container — the one
// the projection should route through when a dependency endpoint provides no
// explicit `interfaceId` hint. Heuristic: prefer an unbound default (taskRef
// missing), otherwise the first interface of that kind by id. Returns null if
// the container has no interface of that kind.
export function getPrimaryInterface(
	doc: PertDoc,
	containerId: TaskId,
	kind: InterfaceKind,
): ContainerInterface | null {
	const list = getInterfacesFor(doc, containerId).filter(
		(i) => i.kind === kind,
	);
	if (list.length === 0) return null;
	const unbound = list.find((i) => !i.taskRef);
	if (unbound) return unbound;
	list.sort((a, b) => a.id.localeCompare(b.id));
	return list[0] ?? null;
}

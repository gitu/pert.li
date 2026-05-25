import { z } from "zod";
import type {
	ContainerInterface,
	Dependency,
	DependencyType,
	PertDoc,
	ProjectCalendar,
	Task,
	TaskId,
} from "./types";
import { createEmptyPertDoc } from "./types";

// Portable, layout-free JSON format for sharing PERT projects between
// instances (or as the on-the-wire payload for `importProject`). Each task
// carries its own predecessor list inline (`dependsOn`) so the file reads
// top-down — a reader can understand any one task without cross-referencing
// a separate edge table. Container interfaces are similarly co-located on
// the container they belong to.
//
// Layout state (node positions, container collapse), derived analytics
// (CPM ES/EF, Monte Carlo), and per-user view state (selection, history
// cursor) are intentionally stripped — re-import re-runs ELK auto-layout
// so the canvas opens at a sensible default.
//
// The matching JSON Schema lives at `src/lib/pert/exchange.schema.json` and
// must be kept in sync with the Zod definitions below — there's a test in
// `__tests__/exchange.test.ts` that spot-checks the structural invariants.

export const EXCHANGE_FORMAT_ID = "pert.li" as const;
export const EXCHANGE_SCHEMA_VERSION = 1 as const;
export const EXCHANGE_FILE_EXTENSION = ".pert.json" as const;
export const EXCHANGE_MIME_TYPE = "application/json" as const;
export const EXCHANGE_SCHEMA_URL =
	"https://pert.li/schemas/v1/exchange.schema.json" as const;

const taskKindSchema = z.enum(["task", "milestone", "container"]);
const estimateUnitSchema = z.enum(["hour", "day", "week"]);
const taskStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
const dependencyTypeSchema = z.enum([
	"finish_to_start",
	"start_to_start",
	"finish_to_finish",
	"start_to_finish",
]);
const interfaceKindSchema = z.enum(["entry", "exit"]);

const estimateSchema = z.object({
	optimistic: z.number().nonnegative(),
	mostLikely: z.number().nonnegative(),
	pessimistic: z.number().nonnegative(),
	unit: estimateUnitSchema,
});

// A single predecessor entry. The owning task is the successor; this entry
// names what it waits on. `taskId` and `interfaceId` are mutually exclusive
// — exactly one must be set. `type` defaults to "finish_to_start" on import.
//
// Storage-internal dependency ids are NOT part of the exchange contract —
// importers synthesize fresh ids per project, so round-trip stability of a
// random `dep_<hex>` string has no semantic meaning.
//
// `lagDays` is also intentionally absent: there's no GUI control to set it,
// so user-created projects don't carry lags. The CPM engine still honours
// lag internally — it just doesn't survive a round-trip through this format.
const dependsOnEntrySchema = z
	.object({
		taskId: z.string().min(1).optional(),
		interfaceId: z.string().min(1).optional(),
		type: dependencyTypeSchema.optional(),
	})
	.refine(
		(d) => (d.taskId ? 1 : 0) + (d.interfaceId ? 1 : 0) === 1,
		"each dependsOn entry must set exactly one of taskId / interfaceId",
	);

const interfaceEntrySchema = z.object({
	id: z.string().min(1),
	kind: interfaceKindSchema,
	label: z.string(),
	taskRef: z.string().optional(),
});

const taskExchangeSchema = z.object({
	id: z.string().min(1),
	kind: taskKindSchema,
	title: z.string(),
	parentId: z.string().nullable(),
	key: z.string().optional(),
	estimate: estimateSchema.optional(),
	notes: z.string().optional(),
	status: taskStatusSchema.optional(),
	progress: z.number().min(0).max(100).optional(),
	actualStart: z.string().optional(),
	actualFinish: z.string().optional(),
	tags: z.array(z.string()).optional(),
	confidence: z.number().min(0).max(1).optional(),
	dependsOn: z.array(dependsOnEntrySchema).optional(),
	// Only meaningful when kind === "container" — defines the entry/exit
	// ports descendants can wire to.
	interfaces: z.array(interfaceEntrySchema).optional(),
});

const calendarExchangeSchema = z.object({
	startDate: z.string(),
	workingDays: z.array(z.number().int().min(1).max(7)),
	holidays: z.array(z.string()).optional(),
	team: z
		.object({
			peopleCount: z.number().nonnegative(),
			availabilityPct: z.number().min(0).max(100),
			useHistoric: z.boolean().optional(),
		})
		.optional(),
	allocationMode: z.enum(["calendar", "team"]).optional(),
});

export const pertExchangeSchema = z.object({
	format: z.literal(EXCHANGE_FORMAT_ID),
	schemaVersion: z.literal(EXCHANGE_SCHEMA_VERSION),
	exportedAt: z.string(),
	title: z.string(),
	tasks: z.array(taskExchangeSchema),
	calendar: calendarExchangeSchema.optional(),
});

export type PertExchange = z.infer<typeof pertExchangeSchema>;
export type TaskExchange = z.infer<typeof taskExchangeSchema>;
export type DependsOnEntry = z.infer<typeof dependsOnEntrySchema>;
export type InterfaceEntry = z.infer<typeof interfaceEntrySchema>;
export type CalendarExchange = z.infer<typeof calendarExchangeSchema>;

// ── Serialize ───────────────────────────────────────────────────────────────

export type ExportOptions = {
	// Defaults to `new Date().toISOString()`. Tests inject a fixed value for
	// deterministic snapshots.
	exportedAt?: string;
};

export function toExchange(
	doc: PertDoc,
	opts: ExportOptions = {},
): PertExchange {
	const exportedAt = opts.exportedAt ?? new Date().toISOString();
	// Bucket deps by their successor task so we can attach them inline.
	const depsBySuccessor = new Map<TaskId, Dependency[]>();
	for (const dep of Object.values(doc.dependenciesById)) {
		const successor = dep.to.taskId;
		if (!successor) continue; // unattached dep — drop silently
		const bucket = depsBySuccessor.get(successor) ?? [];
		bucket.push(dep);
		depsBySuccessor.set(successor, bucket);
	}
	return {
		format: EXCHANGE_FORMAT_ID,
		schemaVersion: EXCHANGE_SCHEMA_VERSION,
		exportedAt,
		title: doc.title,
		tasks: Object.values(doc.tasksById).map((t) =>
			taskToExchange(t, depsBySuccessor.get(t.id), doc),
		),
		calendar: doc.calendar ? calendarToExchange(doc.calendar) : undefined,
	};
}

function taskToExchange(
	task: Task,
	incomingDeps: Dependency[] | undefined,
	doc: PertDoc,
): TaskExchange {
	const out: TaskExchange = {
		id: task.id,
		kind: task.kind,
		title: task.title,
		parentId: task.parentId,
	};
	if (task.key !== undefined) out.key = task.key;
	if (task.estimate) {
		out.estimate = {
			optimistic: task.estimate.optimistic,
			mostLikely: task.estimate.mostLikely,
			pessimistic: task.estimate.pessimistic,
			unit: task.estimate.unit,
		};
	}
	if (task.notes !== undefined) out.notes = task.notes;
	if (task.status !== undefined) out.status = task.status;
	if (task.progress !== undefined) out.progress = task.progress;
	if (task.actualStart !== undefined) out.actualStart = task.actualStart;
	if (task.actualFinish !== undefined) out.actualFinish = task.actualFinish;
	const tags = task.metadata?.tags;
	if (tags && tags.length > 0) out.tags = [...tags];
	if (task.metadata?.confidence !== undefined) {
		out.confidence = task.metadata.confidence;
	}
	if (incomingDeps && incomingDeps.length > 0) {
		out.dependsOn = incomingDeps.map(depToEntry);
	}
	if (task.kind === "container") {
		const interfaces = doc.interfacesByContainerId[task.id];
		if (interfaces) {
			const list = Object.values(interfaces).map(interfaceToEntry);
			if (list.length > 0) out.interfaces = list;
		}
	}
	return out;
}

function depToEntry(dep: Dependency): DependsOnEntry {
	const out: DependsOnEntry = {};
	if (dep.from.taskId !== undefined) out.taskId = dep.from.taskId;
	if (dep.from.interfaceId !== undefined)
		out.interfaceId = dep.from.interfaceId;
	// Default type — drop from output to keep files compact.
	if (dep.type !== "finish_to_start") out.type = dep.type;
	return out;
}

function interfaceToEntry(iface: ContainerInterface): InterfaceEntry {
	return {
		id: iface.id,
		kind: iface.kind,
		label: iface.label,
		...(iface.taskRef !== undefined ? { taskRef: iface.taskRef } : {}),
	};
}

function calendarToExchange(cal: ProjectCalendar): CalendarExchange {
	return {
		startDate: cal.startDate,
		workingDays: [...cal.workingDays],
		...(cal.holidays ? { holidays: [...cal.holidays] } : {}),
		...(cal.team
			? {
					team: {
						peopleCount: cal.team.peopleCount,
						availabilityPct: cal.team.availabilityPct,
						...(cal.team.useHistoric !== undefined
							? { useHistoric: cal.team.useHistoric }
							: {}),
					},
				}
			: {}),
		...(cal.allocationMode ? { allocationMode: cal.allocationMode } : {}),
	};
}

export function serializeExchange(doc: PertDoc, opts?: ExportOptions): string {
	return `${JSON.stringify(toExchange(doc, opts), null, 2)}\n`;
}

// ── Parse / build ───────────────────────────────────────────────────────────

export type ParseResult =
	| { ok: true; exchange: PertExchange }
	| { ok: false; error: string };

export function parseExchange(input: unknown): ParseResult {
	let raw: unknown = input;
	if (typeof input === "string") {
		try {
			raw = JSON.parse(input);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "invalid JSON";
			return { ok: false, error: `Not valid JSON: ${msg}` };
		}
	}
	const result = pertExchangeSchema.safeParse(raw);
	if (!result.success) {
		const first = result.error.issues[0];
		const path = first?.path.join(".") || "(root)";
		return { ok: false, error: `${path}: ${first?.message ?? "invalid"}` };
	}
	return { ok: true, exchange: result.data };
}

export type FromExchangeOptions = {
	// Override the title from the exchange (e.g. user typed a new name in the
	// import dialog). Trimmed; ignored when empty.
	title?: string;
};

export function fromExchange(
	exchange: PertExchange,
	opts: FromExchangeOptions = {},
): PertDoc {
	const titleOverride = opts.title?.trim();
	const doc = createEmptyPertDoc(
		titleOverride && titleOverride.length > 0 ? titleOverride : exchange.title,
	);
	for (const t of exchange.tasks) {
		doc.tasksById[t.id] = taskFromExchange(t);
		if (t.kind === "container" && t.interfaces && t.interfaces.length > 0) {
			const bucket: Record<string, ContainerInterface> = {};
			for (const iface of t.interfaces) {
				bucket[iface.id] = {
					id: iface.id,
					containerId: t.id,
					kind: iface.kind,
					label: iface.label,
					...(iface.taskRef !== undefined ? { taskRef: iface.taskRef } : {}),
				};
			}
			doc.interfacesByContainerId[t.id] = bucket;
		}
	}
	for (const t of exchange.tasks) {
		if (!t.dependsOn) continue;
		for (const entry of t.dependsOn) {
			const dep = entryToDep(entry, t.id);
			doc.dependenciesById[dep.id] = dep;
		}
	}
	if (exchange.calendar) {
		doc.calendar = {
			startDate: exchange.calendar.startDate,
			workingDays: [...exchange.calendar.workingDays],
			...(exchange.calendar.holidays
				? { holidays: [...exchange.calendar.holidays] }
				: {}),
			...(exchange.calendar.team
				? {
						team: {
							peopleCount: exchange.calendar.team.peopleCount,
							availabilityPct: exchange.calendar.team.availabilityPct,
							...(exchange.calendar.team.useHistoric !== undefined
								? { useHistoric: exchange.calendar.team.useHistoric }
								: {}),
						},
					}
				: {}),
			...(exchange.calendar.allocationMode
				? { allocationMode: exchange.calendar.allocationMode }
				: {}),
		};
	}
	return doc;
}

function taskFromExchange(t: TaskExchange): Task {
	const task: Task = {
		id: t.id,
		kind: t.kind,
		title: t.title,
		parentId: t.parentId,
	};
	if (t.key !== undefined) task.key = t.key;
	if (t.estimate) task.estimate = { ...t.estimate };
	if (t.notes !== undefined) task.notes = t.notes;
	if (t.status !== undefined) task.status = t.status;
	if (t.progress !== undefined) task.progress = t.progress;
	if (t.actualStart !== undefined) task.actualStart = t.actualStart;
	if (t.actualFinish !== undefined) task.actualFinish = t.actualFinish;
	if (t.tags || t.confidence !== undefined) {
		task.metadata = {};
		if (t.tags && t.tags.length > 0) task.metadata.tags = [...t.tags];
		if (t.confidence !== undefined) task.metadata.confidence = t.confidence;
	}
	return task;
}

function entryToDep(entry: DependsOnEntry, successorId: TaskId): Dependency {
	const type: DependencyType = entry.type ?? "finish_to_start";
	const fromPort = type.startsWith("finish_") ? "finish" : "start";
	const toPort = type.endsWith("_start") ? "start" : "finish";
	return {
		id: freshDepId(),
		from: {
			...(entry.taskId !== undefined ? { taskId: entry.taskId } : {}),
			...(entry.interfaceId !== undefined
				? { interfaceId: entry.interfaceId }
				: {}),
			port: fromPort,
		},
		to: { taskId: successorId, port: toPort },
		type,
	};
}

// ── Summary (for the import preview UI + tooltip) ───────────────────────────

export type ExchangeSummary = {
	title: string;
	taskCount: number;
	milestoneCount: number;
	containerCount: number;
	dependencyCount: number;
	hasCalendar: boolean;
};

export function summarizeExchange(exchange: PertExchange): ExchangeSummary {
	let taskCount = 0;
	let milestoneCount = 0;
	let containerCount = 0;
	let dependencyCount = 0;
	for (const t of exchange.tasks) {
		if (t.kind === "task") taskCount += 1;
		else if (t.kind === "milestone") milestoneCount += 1;
		else if (t.kind === "container") containerCount += 1;
		dependencyCount += t.dependsOn?.length ?? 0;
	}
	return {
		title: exchange.title,
		taskCount,
		milestoneCount,
		containerCount,
		dependencyCount,
		hasCalendar: !!exchange.calendar,
	};
}

// Local copy of the random-id helper used by addDependencyMutation — we
// keep it inline so this module doesn't reach across the layer boundary
// into `src/lib/ai/`.
function freshDepId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `dep_${s}`;
}

// Used by the export button to pick a sensible download filename.
export function suggestExportFilename(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	const safe = slug.length > 0 ? slug : "project";
	return `${safe}${EXCHANGE_FILE_EXTENSION}`;
}

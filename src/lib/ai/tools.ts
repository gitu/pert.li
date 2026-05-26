import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

// Isomorphic tool definitions for the chat assistant. The same definitions are
// used on both sides: the server merges them into the model's available tools
// (no `execute`), the client supplies `.client(execute)` handlers that mutate
// the active Automerge project doc.
//
// Tool design notes:
//  - Names are snake_case so the model isn't tempted to invent camelCase
//    variants. The OpenAI/Anthropic/Gemini training data heavily favors
//    snake_case for tool names.
//  - Inputs are flat objects; outputs are small JSON shapes the model can
//    cite back in chat ("created task task_abc12345").
//  - Schemas are Zod (standard-schema-compatible) so we get one source of
//    truth for both the JSON schema sent to the LLM and the TS types at
//    the execute site.

const taskKindSchema = z.enum(["task", "milestone", "container"]);
const taskStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
const estimateUnitSchema = z.enum(["hour", "day", "week"]);
const dependencyTypeSchema = z.enum([
	"finish_to_start",
	"start_to_start",
	"finish_to_finish",
	"start_to_finish",
]);
const interfaceKindSchema = z.enum(["entry", "exit"]);
const dependencySideSchema = z.enum(["from", "to"]);

const estimateSchema = z.object({
	optimistic: z.number().nonnegative(),
	mostLikely: z.number().nonnegative(),
	pessimistic: z.number().nonnegative(),
	unit: estimateUnitSchema,
});

const isoDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO yyyy-mm-dd date");

export const readProjectTool = toolDefinition({
	name: "read_project",
	description:
		"Read the active project: title, all tasks (id, title, kind, parentId, key, three-point estimate, status, progress, notes, actualStart/Finish), and dependencies (with type and optional lagDays). Call this BEFORE proposing changes so you reference existing task ids instead of inventing new ones.",
	inputSchema: z.object({}),
	outputSchema: z.object({
		title: z.string(),
		tasks: z.array(
			z.object({
				id: z.string(),
				title: z.string(),
				kind: taskKindSchema,
				parentId: z.string().nullable(),
				key: z.string().optional(),
				estimate: estimateSchema.optional(),
				status: taskStatusSchema.optional(),
				progress: z.number().optional(),
				notes: z.string().optional(),
				actualStart: z.string().optional(),
				actualFinish: z.string().optional(),
			}),
		),
		dependencies: z.array(
			z.object({
				id: z.string(),
				fromTaskId: z.string().nullable(),
				toTaskId: z.string().nullable(),
				type: dependencyTypeSchema,
				lagDays: z.number().optional(),
				fromInterfaceId: z.string().optional(),
				toInterfaceId: z.string().optional(),
			}),
		),
		interfaces: z.array(
			z.object({
				id: z.string(),
				containerId: z.string(),
				kind: interfaceKindSchema,
				label: z.string(),
				taskRef: z.string().optional(),
			}),
		),
	}),
});

export const addTaskTool = toolDefinition({
	name: "add_task",
	description:
		"Add a new task, milestone, or container to the project. Returns the generated id you can reference in follow-up calls (e.g. add_dependency). Default kind is 'task' and default estimate is 1/2/4 days.",
	inputSchema: z.object({
		title: z.string().min(1),
		kind: taskKindSchema.optional(),
		parentId: z.string().nullable().optional(),
		estimate: estimateSchema.optional(),
	}),
	outputSchema: z.object({ id: z.string() }),
});

export const setEstimateTool = toolDefinition({
	name: "set_estimate",
	description:
		"Update a task's three-point estimate (optimistic/mostLikely/pessimistic). The unit defaults to the task's existing unit or 'day'. optimistic <= mostLikely <= pessimistic.",
	inputSchema: z.object({
		taskId: z.string(),
		optimistic: z.number().nonnegative(),
		mostLikely: z.number().nonnegative(),
		pessimistic: z.number().nonnegative(),
		unit: estimateUnitSchema.optional(),
	}),
	outputSchema: z.union([
		z.object({ ok: z.literal(true) }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const setTitleTool = toolDefinition({
	name: "set_title",
	description: "Rename a task by id.",
	inputSchema: z.object({ taskId: z.string(), title: z.string().min(1) }),
	outputSchema: z.union([
		z.object({ ok: z.literal(true) }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const addDependencyTool = toolDefinition({
	name: "add_dependency",
	description:
		"Create a dependency edge between two tasks. Default type is 'finish_to_start' (the most common). Returns the dependency id. If the same edge already exists, returns the existing id instead of duplicating.",
	inputSchema: z.object({
		fromTaskId: z.string(),
		toTaskId: z.string(),
		type: dependencyTypeSchema.optional(),
	}),
	outputSchema: z.union([
		z.object({ id: z.string() }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const removeDependencyTool = toolDefinition({
	name: "remove_dependency",
	description: "Delete a dependency by id.",
	inputSchema: z.object({ dependencyId: z.string() }),
	outputSchema: z.union([
		z.object({ ok: z.literal(true) }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const removeTaskTool = toolDefinition({
	name: "remove_task",
	description:
		"Delete a task and any dependencies touching it. Children of the task are promoted to top-level rather than cascade-deleted.",
	inputSchema: z.object({ taskId: z.string() }),
	outputSchema: z.union([
		z.object({ ok: z.literal(true) }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

const okOrErrorSchema = z.union([
	z.object({ ok: z.literal(true) }),
	z.object({ ok: z.literal(false), error: z.string() }),
]);

export const setKindTool = toolDefinition({
	name: "set_kind",
	description:
		"Change a task's kind (task | milestone | container). Milestones drop their estimate; tasks gain a default 1/2/4 day estimate if they don't have one.",
	inputSchema: z.object({ taskId: z.string(), kind: taskKindSchema }),
	outputSchema: okOrErrorSchema,
});

export const setKeyTool = toolDefinition({
	name: "set_key",
	description:
		"Set or clear a task's semantic grouping key (dotted, e.g. 'M1.A'). Pass an empty string or null to clear. Purely a grouping label — not a dependency or hierarchy.",
	inputSchema: z.object({
		taskId: z.string(),
		key: z.string().nullable(),
	}),
	outputSchema: okOrErrorSchema,
});

export const setNotesTool = toolDefinition({
	name: "set_notes",
	description:
		"Set or clear a task's free-form notes. Pass an empty string or null to clear.",
	inputSchema: z.object({
		taskId: z.string(),
		notes: z.string().nullable(),
	}),
	outputSchema: okOrErrorSchema,
});

export const moveTaskTool = toolDefinition({
	name: "move_task",
	description:
		"Reparent a task: move it into a container, or pass parentId=null to promote it to the top level. Fails on cycles or non-container targets.",
	inputSchema: z.object({
		taskId: z.string(),
		parentId: z.string().nullable(),
	}),
	outputSchema: okOrErrorSchema,
});

export const setStatusTool = toolDefinition({
	name: "set_status",
	description:
		"Update a task's status (not_started | in_progress | completed). Side-effects match the inspector: in_progress stamps actualStart (today) and ensures progress; completed sets progress=100 and stamps actualFinish (today); not_started clears progress and both actual dates.",
	inputSchema: z.object({
		taskId: z.string(),
		status: taskStatusSchema,
	}),
	outputSchema: okOrErrorSchema,
});

export const setProgressTool = toolDefinition({
	name: "set_progress",
	description:
		"Set a task's completion percentage (0–100, clamped). Flips status to in_progress when leaving 0, and to completed when reaching 100. Stamps actualStart/Finish (today) where appropriate.",
	inputSchema: z.object({
		taskId: z.string(),
		progress: z.number(),
	}),
	outputSchema: okOrErrorSchema,
});

export const setActualDatesTool = toolDefinition({
	name: "set_actual_dates",
	description:
		"Set or clear a task's recorded Started / Finished dates (ISO yyyy-mm-dd). Omit a field to leave it unchanged; pass null to clear it. Use this to backfill historical data without changing status.",
	inputSchema: z.object({
		taskId: z.string(),
		actualStart: isoDateSchema.nullable().optional(),
		actualFinish: isoDateSchema.nullable().optional(),
	}),
	outputSchema: okOrErrorSchema,
});

export const setDependencyTool = toolDefinition({
	name: "set_dependency",
	description:
		"Edit an existing dependency: change its type (FS/SS/FF/SF) and/or lag (days; negative = lead). Omit a field to leave it unchanged; pass null for lagDays to clear it.",
	inputSchema: z.object({
		dependencyId: z.string(),
		type: dependencyTypeSchema.optional(),
		lagDays: z.number().nullable().optional(),
	}),
	outputSchema: okOrErrorSchema,
});

export const addInterfaceTool = toolDefinition({
	name: "add_interface",
	description:
		"Add a named entry or exit port to a container. Use this when an external caller needs to depend on a specific milestone inside the container rather than the container as a whole. Optionally pin the interface to a descendant via taskRef so the projection can route collapsed edges precisely.",
	inputSchema: z.object({
		containerId: z.string(),
		kind: interfaceKindSchema,
		label: z.string().optional(),
		taskRef: z.string().nullable().optional(),
	}),
	outputSchema: z.union([
		z.object({ id: z.string() }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const removeInterfaceTool = toolDefinition({
	name: "remove_interface",
	description:
		"Delete a container interface. Existing dependencies that hint at this interface keep their canonical taskId endpoint; the orphaned hint is ignored by the projection.",
	inputSchema: z.object({
		containerId: z.string(),
		interfaceId: z.string(),
	}),
	outputSchema: okOrErrorSchema,
});

export const setInterfaceTool = toolDefinition({
	name: "set_interface",
	description:
		"Edit an existing container interface: rename it and/or rebind it to a descendant task. Omit a field to leave it unchanged. Pass taskRef=null to unbind.",
	inputSchema: z.object({
		containerId: z.string(),
		interfaceId: z.string(),
		label: z.string().optional(),
		taskRef: z.string().nullable().optional(),
	}),
	outputSchema: okOrErrorSchema,
});

export const pinDependencyTool = toolDefinition({
	name: "pin_dependency",
	description:
		"Pin one side of a dependency to a specific container interface. The dep's canonical taskId stays the same — the interface is the port the edge attaches to when the container is collapsed. Pass interfaceId=null to clear the pin.",
	inputSchema: z.object({
		dependencyId: z.string(),
		side: dependencySideSchema,
		interfaceId: z.string().nullable(),
	}),
	outputSchema: okOrErrorSchema,
});

// Presents a multiple-choice question to the user. The tool itself just
// acknowledges immediately; the UI surfaces the question + clickable chips
// above the chat input. Clicking a chip sends `value` (falling back to
// `label`) as the user's next message. The user can still type freeform —
// the chips are an assist, not a gate.
export const askChoiceTool = toolDefinition({
	name: "ask_choice",
	description:
		"Present a multiple-choice question to the user. Use during tutorials, for clarifying questions, or whenever the next step branches on a small set of choices. The UI renders the options as buttons below your message — DO NOT also list them as text or write 'pick one' (the buttons make that obvious). The user may also type a freeform reply.",
	inputSchema: z.object({
		question: z
			.string()
			.min(1)
			.describe(
				"The question to ask. Keep it under ~140 chars — it appears as a small label above the chips.",
			),
		options: z
			.array(
				z.object({
					label: z
						.string()
						.min(1)
						.describe(
							"Short text shown on the button. Keep under ~32 chars so chips wrap cleanly.",
						),
					value: z
						.string()
						.optional()
						.describe(
							"Optional message text sent on click. Defaults to `label`. Use this when the human-readable label is shorter than the answer you want the user's message to carry (e.g. label 'Yes' → value 'Yes, continue with the critical path section').",
						),
				}),
			)
			.min(2)
			.max(6)
			.describe("Between 2 and 6 mutually-exclusive options."),
	}),
	outputSchema: z.object({ ok: z.literal(true) }),
});

export const CHAT_TOOL_DEFINITIONS = [
	readProjectTool,
	addTaskTool,
	setTitleTool,
	setKindTool,
	setKeyTool,
	setNotesTool,
	setEstimateTool,
	setStatusTool,
	setProgressTool,
	setActualDatesTool,
	moveTaskTool,
	addDependencyTool,
	setDependencyTool,
	removeDependencyTool,
	removeTaskTool,
	addInterfaceTool,
	removeInterfaceTool,
	setInterfaceTool,
	pinDependencyTool,
	askChoiceTool,
] as const;

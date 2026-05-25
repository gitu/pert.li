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
const estimateUnitSchema = z.enum(["hour", "day", "week"]);
const dependencyTypeSchema = z.enum([
	"finish_to_start",
	"start_to_start",
	"finish_to_finish",
	"start_to_finish",
]);

const estimateSchema = z.object({
	optimistic: z.number().nonnegative(),
	mostLikely: z.number().nonnegative(),
	pessimistic: z.number().nonnegative(),
	unit: estimateUnitSchema,
});

export const readProjectTool = toolDefinition({
	name: "read_project",
	description:
		"Read the active project: title, all tasks (id, title, kind, parentId, three-point estimate), and dependencies. Call this BEFORE proposing changes so you reference existing task ids instead of inventing new ones.",
	inputSchema: z.object({}),
	outputSchema: z.object({
		title: z.string(),
		tasks: z.array(
			z.object({
				id: z.string(),
				title: z.string(),
				kind: taskKindSchema,
				parentId: z.string().nullable(),
				estimate: estimateSchema.optional(),
			}),
		),
		dependencies: z.array(
			z.object({
				id: z.string(),
				fromTaskId: z.string().nullable(),
				toTaskId: z.string().nullable(),
				type: dependencyTypeSchema,
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
	setEstimateTool,
	setTitleTool,
	addDependencyTool,
	removeDependencyTool,
	removeTaskTool,
	askChoiceTool,
] as const;

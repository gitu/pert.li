import { z } from "zod";

// Discriminated union representing one edit operation across the PertDoc.
// Each variant maps 1:1 onto an existing per-tool mutator in
// tool-mutators.ts — see apply-operations.ts for the dispatcher.
//
// Used by the `propose_changes` AI tool: the LLM emits a batch of these and
// the client builds a "proposed doc" (current cloned + each op applied) to
// show the user a diff before any of it lands on the live doc.

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

// Operations carry a stable `op` discriminator the LLM is more likely to get
// right than camelCase tool names. Inputs match the per-tool Zod schemas in
// tools.ts so existing prompts about each tool stay valid context.
export const editOpSchema = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("add_task"),
		// Optional client-provided id. Lets the model reference a task it just
		// added later in the same batch (e.g. add_task id=tmp_a then
		// add_dependency from=tmp_a). If omitted, the mutator generates one.
		id: z.string().optional(),
		title: z.string().min(1),
		kind: taskKindSchema.optional(),
		parentId: z.string().nullable().optional(),
		estimate: estimateSchema.optional(),
	}),
	z.object({
		op: z.literal("remove_task"),
		taskId: z.string(),
	}),
	z.object({
		op: z.literal("set_title"),
		taskId: z.string(),
		title: z.string().min(1),
	}),
	z.object({
		op: z.literal("set_kind"),
		taskId: z.string(),
		kind: taskKindSchema,
	}),
	z.object({
		op: z.literal("set_key"),
		taskId: z.string(),
		key: z.string().nullable(),
	}),
	z.object({
		op: z.literal("set_notes"),
		taskId: z.string(),
		notes: z.string().nullable(),
	}),
	z.object({
		op: z.literal("set_estimate"),
		taskId: z.string(),
		optimistic: z.number().nonnegative(),
		mostLikely: z.number().nonnegative(),
		pessimistic: z.number().nonnegative(),
		unit: estimateUnitSchema.optional(),
	}),
	z.object({
		op: z.literal("set_status"),
		taskId: z.string(),
		status: taskStatusSchema,
	}),
	z.object({
		op: z.literal("set_progress"),
		taskId: z.string(),
		progress: z.number(),
	}),
	z.object({
		op: z.literal("set_actual_dates"),
		taskId: z.string(),
		actualStart: isoDateSchema.nullable().optional(),
		actualFinish: isoDateSchema.nullable().optional(),
	}),
	z.object({
		op: z.literal("move_task"),
		taskId: z.string(),
		parentId: z.string().nullable(),
	}),
	z.object({
		op: z.literal("add_dependency"),
		id: z.string().optional(),
		fromTaskId: z.string(),
		toTaskId: z.string(),
		type: dependencyTypeSchema.optional(),
	}),
	z.object({
		op: z.literal("remove_dependency"),
		dependencyId: z.string(),
	}),
	z.object({
		op: z.literal("set_dependency"),
		dependencyId: z.string(),
		type: dependencyTypeSchema.optional(),
		lagDays: z.number().nullable().optional(),
	}),
	z.object({
		op: z.literal("pin_dependency"),
		dependencyId: z.string(),
		side: dependencySideSchema,
		interfaceId: z.string().nullable(),
	}),
	z.object({
		op: z.literal("add_interface"),
		id: z.string().optional(),
		containerId: z.string(),
		kind: interfaceKindSchema,
		label: z.string().optional(),
		taskRef: z.string().nullable().optional(),
	}),
	z.object({
		op: z.literal("remove_interface"),
		containerId: z.string(),
		interfaceId: z.string(),
	}),
	z.object({
		op: z.literal("set_interface"),
		containerId: z.string(),
		interfaceId: z.string(),
		label: z.string().optional(),
		taskRef: z.string().nullable().optional(),
	}),
]);

export type EditOp = z.infer<typeof editOpSchema>;
export type EditOpKind = EditOp["op"];

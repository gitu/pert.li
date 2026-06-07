import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { editOpSchema } from "./operations";

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

const taskKindSchema = z.enum(["task", "milestone"]);
const taskStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
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

const isoDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO yyyy-mm-dd date");

const documentKindSchema = z.enum(["text", "pdf", "docx"]);

// Manifest entry — describes an attached document without its text. Used by
// read_project and list_documents so the model knows what's available and can
// read on demand via read_document.
const documentManifestEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	kind: documentKindSchema,
	pages: z.number().optional(),
	truncated: z.boolean(),
	charCount: z.number(),
});

const projectSummarySchema = z.object({
	title: z.string(),
	groups: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			parentGroupId: z.string().nullable(),
			number: z.string(),
		}),
	),
	tasks: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			kind: taskKindSchema,
			groupId: z.string().nullable(),
			number: z.string(),
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
		}),
	),
	attachedDocuments: z.array(documentManifestEntrySchema),
});

export const readProjectTool = toolDefinition({
	name: "read_project",
	description:
		"Read the active project: title, all groups (id, name, parentGroupId, WBS number), all tasks (id, title, kind, groupId, WBS number, three-point estimate, status, progress, notes, actualStart/Finish), dependencies (with type and optional lagDays), and a manifest of attached source documents (id, name, kind, pages) — call read_document to read a document's text. Call this BEFORE proposing changes so you reference existing ids instead of inventing new ones.",
	inputSchema: z.object({}),
	// Returns the project summary OR the "no active project" error shape the
	// client emits when the user hasn't opened a project. The model treats it
	// the same way as any other ok:false response — surface and stop.
	outputSchema: z.union([
		projectSummarySchema,
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const listDocumentsTool = toolDefinition({
	name: "list_documents",
	description:
		"List the source documents attached to this project (e.g. the specs/briefs the user uploaded when creating it). Returns a manifest — id, name, kind, page count, character count — but NOT the text. Call read_document to read a document's contents.",
	inputSchema: z.object({}),
	outputSchema: z.union([
		z.object({ documents: z.array(documentManifestEntrySchema) }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const readDocumentTool = toolDefinition({
	name: "read_document",
	description:
		"Read the full extracted text of one attached document by its id (from list_documents or read_project). Use this to ground tasks and estimates in the source material, and to set metadata.sourceRefs.documentId on tasks you derive from a document so their provenance is captured.",
	inputSchema: z.object({
		documentId: z
			.string()
			.describe("The document id from the manifest, e.g. 'doc_ab12…'."),
	}),
	outputSchema: z.union([
		z.object({
			ok: z.literal(true),
			id: z.string(),
			name: z.string(),
			kind: documentKindSchema,
			pages: z.number().optional(),
			truncated: z.boolean(),
			text: z.string(),
		}),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const addTaskTool = toolDefinition({
	name: "add_task",
	description:
		"Add a new task or milestone to the project. Optionally assign it to a group by id (its WBS number is derived from the group). Returns the generated id you can reference in follow-up calls (e.g. add_dependency). Default kind is 'task' and default estimate is 1/2/4 days.",
	inputSchema: z.object({
		title: z.string().min(1),
		kind: taskKindSchema.optional(),
		groupId: z.string().nullable().optional(),
		estimate: estimateSchema.optional(),
	}),
	outputSchema: z.union([
		z.object({ id: z.string() }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
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
		"Change a task's kind (task | milestone). Milestones drop their estimate; tasks gain a default 1/2/4 day estimate if they don't have one.",
	inputSchema: z.object({ taskId: z.string(), kind: taskKindSchema }),
	outputSchema: okOrErrorSchema,
});

export const setTaskNumberTool = toolDefinition({
	name: "set_task_number",
	description:
		"Override a task's auto WBS number with a fixed value, or clear the override. Pass an empty string or null to clear (the task reverts to its auto-derived number from its group). A pinned override survives group moves.",
	inputSchema: z.object({
		taskId: z.string(),
		number: z.string().nullable(),
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

export const moveTaskToGroupTool = toolDefinition({
	name: "move_task_to_group",
	description:
		"Move a task into a group by id, or pass groupId=null to make it ungrouped. The task's auto WBS number recomputes for the new group; a pinned override (see set_task_number) is left intact.",
	inputSchema: z.object({
		taskId: z.string(),
		groupId: z.string().nullable(),
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

export const createGroupTool = toolDefinition({
	name: "create_group",
	description:
		"Create a named group. Groups organise tasks into a collapsible box on the canvas and seed their members' WBS numbers. Optionally nest it under another group via parentGroupId. Returns the new group id you can pass to add_task / move_task_to_group.",
	inputSchema: z.object({
		name: z.string().min(1),
		parentGroupId: z.string().nullable().optional(),
	}),
	outputSchema: z.union([
		z.object({ id: z.string() }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const renameGroupTool = toolDefinition({
	name: "rename_group",
	description: "Rename a group by id.",
	inputSchema: z.object({ groupId: z.string(), name: z.string().min(1) }),
	outputSchema: okOrErrorSchema,
});

export const setGroupParentTool = toolDefinition({
	name: "set_group_parent",
	description:
		"Re-parent a group: nest it under another group by id, or pass parentGroupId=null to make it top-level. Fails if it would create a group cycle.",
	inputSchema: z.object({
		groupId: z.string(),
		parentGroupId: z.string().nullable(),
	}),
	outputSchema: okOrErrorSchema,
});

export const deleteGroupTool = toolDefinition({
	name: "delete_group",
	description:
		"Delete a group. Its member tasks and child groups are PROMOTED to the group's parent (or to ungrouped / top-level) — tasks are never deleted.",
	inputSchema: z.object({ groupId: z.string() }),
	outputSchema: okOrErrorSchema,
});

// Stages a batch of edits for the user to review. The tool itself does NOT
// touch the live doc — it builds a cloned PertDoc with the operations
// applied, computes the diff, and returns a proposal id. The chat UI then
// renders a proposal card with the diff and Apply / Reject controls. Use
// this for broad edits (re-estimate the auth tasks based on the attached
// spec; introduce a milestone and rewire dependencies; etc.) so the user
// gets one consolidated review surface instead of N individual mutations.
export const proposeChangesTool = toolDefinition({
	name: "propose_changes",
	description:
		"Stage a batch of edits across the project for the user to review before anything lands. Returns a proposalId — the chat UI renders the resulting diff with per-row Apply and Apply-all controls. Use this for any edit that touches more than ~3 tasks, or any time you re-estimate from an attached document. Individual edit tools (set_estimate, add_task, …) still exist for single, surgical fixes.",
	inputSchema: z.object({
		rationale: z
			.string()
			.min(1)
			.describe(
				"One or two sentences the user will see at the top of the proposal card explaining why these changes hang together (e.g. 'Re-estimated the auth tasks from the attached spec — adding a 5-day spike for OIDC discovery).' Don't restate the operations; the diff does that.",
			),
		operations: z
			.array(editOpSchema)
			.min(1)
			.describe(
				"Edit operations in the order they should apply. Each operation mirrors one of the single-task tools. You may use client-provided ids on add_task / add_dependency / create_group to reference newly-added entities in later operations within the same batch. Every entry must be a REAL edit — never include placeholder or probe operations (they fail to stage and the user sees an empty proposal). Ungrouped tasks take groupId: null; there is no id for the project itself.",
			),
	}),
	outputSchema: z.union([
		z.object({
			ok: z.literal(true),
			proposalId: z.string(),
			summary: z.object({
				tasksAffected: z.number(),
				depsAffected: z.number(),
				operationsApplied: z.number(),
				operationsFailed: z.number(),
				// Operations that could NOT be staged and are excluded from the
				// user's preview, with the reason each one failed. When this is
				// non-empty, fix those operations and call propose_changes again —
				// the most common causes are referencing a task id that doesn't
				// exist (use read_project or ids returned by earlier operations)
				// and inventing placeholder ids like "__ROOT__" or "__PROJECT__";
				// ungrouped tasks take groupId: null.
				failures: z.array(
					z.object({
						operationIndex: z.number(),
						op: z.string(),
						error: z.string(),
					}),
				),
			}),
			// Present (true) when an approved work plan is executing: the staged
			// changes were applied to the document immediately — no user click
			// needed. Absent when the proposal awaits the user's review.
			autoApplied: z.boolean().optional(),
			// Per-operation failures from the auto-apply pass (op existed in the
			// staging preview but couldn't be applied to the live doc).
			applyFailures: z
				.array(z.object({ op: z.string(), error: z.string() }))
				.optional(),
		}),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

// ── Work plan tools ──────────────────────────────────────────────────────────
// Plan-and-execute mode for large changes (bulk imports, restructurings).
// The assistant drafts a structured plan of steps, the USER approves it on
// the plan card (no chat tool can approve), and execution then runs step by
// step with changes applying directly to the doc.

const workPlanStepStatusSchema = z.enum([
	"pending",
	"in_progress",
	"completed",
	"failed",
	"skipped",
]);

const workPlanStepInputSchema = z.object({
	title: z
		.string()
		.min(1)
		.describe("Short imperative step name, e.g. 'Create phase groups'."),
	description: z
		.string()
		.min(1)
		.describe(
			"Everything needed to execute this step WITHOUT re-reading the source documents: the concrete groups/tasks/dependencies to create, with titles and estimates. One step should be 5–15 operations of work.",
		),
});

const workPlanProgressSchema = z.object({
	completed: z.number(),
	failed: z.number(),
	total: z.number(),
});

const workPlanSummarySchema = z.object({
	planId: z.string(),
	title: z.string(),
	rationale: z.string(),
	status: z.enum(["draft", "approved", "executing", "completed", "cancelled"]),
	progress: workPlanProgressSchema,
	steps: z.array(
		z.object({
			stepId: z.string(),
			title: z.string(),
			description: z.string(),
			status: workPlanStepStatusSchema,
			result: z.string().optional(),
		}),
	),
});

export const createWorkPlanTool = toolDefinition({
	name: "create_work_plan",
	description:
		"Create a structured work plan (a todo list of steps) for a large multi-step change — importing an attached document, restructuring the whole project, bulk re-estimation. Each step should be 5–15 operations of work, with a description complete enough to execute later without the source document. The plan starts as a DRAFT: the user must approve it on the plan card before you may execute anything. Creating a new plan replaces any existing one.",
	inputSchema: z.object({
		title: z.string().min(1).max(120),
		rationale: z
			.string()
			.min(1)
			.describe("Why this plan exists — shown to the user on the plan card."),
		steps: z.array(workPlanStepInputSchema).min(1).max(30),
	}),
	outputSchema: z.union([
		z.object({ ok: z.literal(true), planId: z.string() }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const updateWorkPlanTool = toolDefinition({
	name: "update_work_plan",
	description:
		"Update the work plan: mark steps in_progress/completed/failed (with a result note), add steps (e.g. the user attached another document), remove or rewrite steps. Marking every step completed/skipped/failed completes the plan. Use this BEFORE and AFTER executing each step so the user sees live progress.",
	inputSchema: z.object({
		updateSteps: z
			.array(
				z.object({
					stepId: z.string(),
					title: z.string().optional(),
					description: z.string().optional(),
					status: workPlanStepStatusSchema.optional(),
					result: z
						.string()
						.optional()
						.describe(
							"Outcome note once executed: what was created, or why it failed.",
						),
				}),
			)
			.optional(),
		addSteps: z.array(workPlanStepInputSchema).optional(),
		removeStepIds: z.array(z.string()).optional(),
	}),
	outputSchema: z.union([
		z.object({ ok: z.literal(true), progress: workPlanProgressSchema }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

export const getWorkPlanTool = toolDefinition({
	name: "get_work_plan",
	description:
		"Read the current work plan: status (draft/approved/executing/completed/cancelled), steps with their stepIds and statuses, and progress. Call this when resuming execution to find the next pending step.",
	inputSchema: z.object({}),
	outputSchema: z.union([
		z.object({ ok: z.literal(true), plan: workPlanSummarySchema }),
		z.object({
			ok: z.literal(false),
			error: z.string(),
		}),
	]),
});

// Creates a branch (fork) of the project this chat is bound to. The client
// handler calls the same forkProject server fn as the "Branch this plan"
// dialog, so workspace membership and write access are enforced server-side.
// The branch is a sibling project: same workspace, its own Automerge doc,
// its own share links and chat history.
export const createBranchTool = toolDefinition({
	name: "create_branch",
	description:
		"Create a branch (an independent copy) of the current project. Use this when the user wants to explore an alternative plan — a what-if restructuring, a re-estimate, a descope — without touching the main plan. Returns the new branch's projectId. Changes in a branch can later be merged back via the app's Merge drawer. To continue THIS conversation inside the new branch, call move_chat_to_project with the returned projectId.",
	inputSchema: z.object({
		title: z
			.string()
			.min(1)
			.max(120)
			.describe(
				"Name for the branch, e.g. 'Descope: launch without SSO'. Keep it short — it shows in the project sidebar.",
			),
		description: z
			.string()
			.max(500)
			.optional()
			.describe(
				"Optional one-line description of why this branch exists. Shows as a muted second line in the sidebar.",
			),
	}),
	outputSchema: z.union([
		z.object({
			ok: z.literal(true),
			projectId: z.string(),
			title: z.string(),
		}),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
});

// Moves the current chat conversation to another project (typically a branch
// created moments ago with create_branch) and navigates the app there. The
// move happens after the current response finishes streaming so nothing is
// cut off mid-sentence.
export const moveChatTool = toolDefinition({
	name: "move_chat_to_project",
	description:
		"Move this chat conversation to another project and navigate the app to it. Typical flow: create_branch → move_chat_to_project(projectId from the result) → keep working inside the branch. After the move, your tools operate on the target project's plan. The navigation happens when your current response finishes — tell the user the app is about to switch.",
	inputSchema: z.object({
		projectId: z
			.string()
			.describe(
				"Target project id — e.g. the projectId returned by create_branch.",
			),
	}),
	outputSchema: z.union([
		z.object({ ok: z.literal(true), willNavigate: z.boolean() }),
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
	listDocumentsTool,
	readDocumentTool,
	addTaskTool,
	setTitleTool,
	setKindTool,
	setTaskNumberTool,
	setNotesTool,
	setEstimateTool,
	setStatusTool,
	setProgressTool,
	setActualDatesTool,
	moveTaskToGroupTool,
	addDependencyTool,
	setDependencyTool,
	removeDependencyTool,
	removeTaskTool,
	createGroupTool,
	renameGroupTool,
	setGroupParentTool,
	deleteGroupTool,
	proposeChangesTool,
	createWorkPlanTool,
	updateWorkPlanTool,
	getWorkPlanTool,
	createBranchTool,
	moveChatTool,
	askChoiceTool,
] as const;

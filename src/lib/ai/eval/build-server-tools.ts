import { convertSchemaToJsonSchema, type Tool } from "@tanstack/ai";
import type { PertDoc } from "#/lib/pert/types";
import { applyOperations } from "../apply-operations";
import { toGeminiCompatibleSchema } from "../gemini-compat";
import { toOpenAiCompatibleSchema } from "../openai-compat";
import type { EditOp } from "../operations";
import type { ProviderName } from "../provider";
import {
	type AddDependencyArgs,
	type AddTaskArgs,
	addDependencyMutation,
	addTaskMutation,
	assignTaskToGroupMutation,
	createGroupMutation,
	deleteGroupMutation,
	listDocuments,
	newId,
	type RemoveDependencyArgs,
	type RemoveTaskArgs,
	readDocument,
	removeDependencyMutation,
	removeTaskMutation,
	renameGroupMutation,
	type SetActualDatesArgs,
	type SetDependencyArgs,
	type SetEstimateArgs,
	type SetKindArgs,
	type SetNotesArgs,
	type SetProgressArgs,
	type SetStatusArgs,
	type SetTitleArgs,
	setActualDatesMutation,
	setDependencyMutation,
	setEstimateMutation,
	setGroupParentMutation,
	setKindMutation,
	setNotesMutation,
	setProgressMutation,
	setStatusMutation,
	setTaskNumberMutation,
	setTitleMutation,
	summarizeProject,
} from "../tool-mutators";
import { CHAT_TOOL_DEFINITIONS } from "../tools";
import {
	type CreateWorkPlanArgs,
	createWorkPlanMutation,
	summarizeWorkPlan,
	type UpdateWorkPlanArgs,
	updateWorkPlanMutation,
} from "../work-plan-mutators";

// Headless, server-side equivalents of the chat tools. The live app runs each
// tool's `.client(execute)` against the browser-side Automerge doc
// (chat-panel.tsx); the production server strips execute and ferries calls to
// the browser. The eval harness does neither — it attaches `.server(execute)`
// handlers that run the SAME pure mutators (tool-mutators.ts) against a plain
// in-memory PertDoc, so the real agent loop completes whole trajectories with
// no Automerge / repo / sync / browser involved. Each call is recorded so the
// scenario can assert on which tools the model chose and with what arguments.

/** One recorded tool invocation: what the model called, with what, and the result. */
export type ToolCall = {
	name: string;
	args: unknown;
	result: unknown;
};

// Per-tool server executors. Mirror chat-panel.tsx's client handlers, minus the
// getEditableDoc/changeDoc wrapper (we mutate the shared in-memory doc directly).
// `args` arrives as the model emitted it (no Zod parse — the adapter passes the
// raw object), which is exactly what the live mutators already defend against.
type Executor = (doc: PertDoc, args: Record<string, unknown>) => unknown;

const EXECUTORS: Record<string, Executor> = {
	read_project: (doc) => summarizeProject(doc),
	list_documents: (doc) => listDocuments(doc),
	read_document: (doc, args) =>
		readDocument(doc, args as unknown as { documentId: string }),
	add_task: (doc, args) => addTaskMutation(doc, args as unknown as AddTaskArgs),
	set_title: (doc, args) =>
		setTitleMutation(doc, args as unknown as SetTitleArgs),
	set_kind: (doc, args) => setKindMutation(doc, args as unknown as SetKindArgs),
	set_task_number: (doc, args) =>
		setTaskNumberMutation(
			doc,
			args as unknown as { taskId: string; number: string | null },
		),
	set_notes: (doc, args) =>
		setNotesMutation(doc, args as unknown as SetNotesArgs),
	set_estimate: (doc, args) =>
		setEstimateMutation(doc, args as unknown as SetEstimateArgs),
	set_status: (doc, args) =>
		setStatusMutation(doc, args as unknown as SetStatusArgs),
	set_progress: (doc, args) =>
		setProgressMutation(doc, args as unknown as SetProgressArgs),
	set_actual_dates: (doc, args) =>
		setActualDatesMutation(doc, args as unknown as SetActualDatesArgs),
	move_task_to_group: (doc, args) =>
		assignTaskToGroupMutation(
			doc,
			args as unknown as { taskId: string; groupId: string | null },
		),
	add_dependency: (doc, args) =>
		addDependencyMutation(doc, args as unknown as AddDependencyArgs),
	set_dependency: (doc, args) =>
		setDependencyMutation(doc, args as unknown as SetDependencyArgs),
	remove_dependency: (doc, args) =>
		removeDependencyMutation(doc, args as unknown as RemoveDependencyArgs),
	remove_task: (doc, args) =>
		removeTaskMutation(doc, args as unknown as RemoveTaskArgs),
	create_group: (doc, args) => {
		const r = createGroupMutation(
			doc,
			args as unknown as { name?: string; parentGroupId?: string | null },
		);
		return r.ok ? { id: r.id } : r;
	},
	rename_group: (doc, args) =>
		renameGroupMutation(
			doc,
			args as unknown as { groupId: string; name: string },
		),
	set_group_parent: (doc, args) =>
		setGroupParentMutation(
			doc,
			args as unknown as { groupId: string; parentGroupId: string | null },
		),
	delete_group: (doc, args) => {
		const r = deleteGroupMutation(doc, args as unknown as { groupId: string });
		return r.ok ? { ok: true as const } : r;
	},
	// propose_changes: apply the batch to the doc and synthesise the summary the
	// real client returns. In the live app these auto-apply only once a work
	// plan is approved; for evals we always apply so multi-op trajectories land.
	propose_changes: (doc, args) => {
		const rationale = typeof args.rationale === "string" ? args.rationale : "";
		const operations = args.operations;
		// Shape-check before applyOperations: a non-array (or empty) would
		// otherwise throw mid-iteration and abort the run before the schema
		// guard can report what was malformed. Return the structured error the
		// model already knows how to recover from.
		if (!Array.isArray(operations) || operations.length === 0) {
			return {
				ok: false as const,
				error: "propose_changes needs a non-empty operations array",
			};
		}
		if (!rationale) {
			return { ok: false as const, error: "propose_changes needs a rationale" };
		}
		const results = applyOperations(doc, operations as EditOp[]);
		const failures = results.flatMap((r) =>
			r.ok ? [] : [{ operationIndex: r.index, op: r.op, error: r.error }],
		);
		const applied = results.filter((r) => r.ok);
		const taskOps = new Set([
			"add_task",
			"remove_task",
			"set_title",
			"set_kind",
			"set_task_number",
			"set_notes",
			"set_estimate",
			"set_status",
			"set_progress",
			"set_actual_dates",
			"move_task_to_group",
		]);
		const depOps = new Set([
			"add_dependency",
			"remove_dependency",
			"set_dependency",
		]);
		return {
			ok: true as const,
			proposalId: newId("proposal"),
			autoApplied: true,
			summary: {
				tasksAffected: applied.filter((r) => taskOps.has(r.op)).length,
				depsAffected: applied.filter((r) => depOps.has(r.op)).length,
				operationsApplied: applied.length,
				operationsFailed: failures.length,
				failures,
			},
		};
	},
	create_work_plan: (doc, args) => {
		const created = createWorkPlanMutation(
			doc,
			args as unknown as CreateWorkPlanArgs,
		);
		return "planId" in created
			? { ok: true as const, planId: created.planId }
			: created;
	},
	update_work_plan: (doc, args) =>
		updateWorkPlanMutation(doc, args as unknown as UpdateWorkPlanArgs),
	get_work_plan: (doc) => {
		const plan = doc.workPlan;
		if (!plan) {
			return {
				ok: false as const,
				error:
					"No work plan exists for this project. Create one with create_work_plan.",
			};
		}
		return { ok: true as const, plan: summarizeWorkPlan(plan) };
	},
	// Side-effecting tools the harness can't run for real (they fork projects /
	// navigate / drive UI). Record the call and hand back a plausible success so
	// the agent loop continues — scenarios assert on the call, not the effect.
	create_branch: (_doc, args) => ({
		ok: true as const,
		projectId: "proj_eval_branch",
		title: typeof args.title === "string" ? args.title : "branch",
	}),
	move_chat_to_project: () => ({ ok: true as const, willNavigate: true }),
	ask_choice: () => ({ ok: true as const }),
};

function rewriteFor(provider: ProviderName) {
	switch (provider) {
		case "gemini":
			return toGeminiCompatibleSchema;
		case "openai":
			return toOpenAiCompatibleSchema;
		case "anthropic":
			return null;
	}
}

/**
 * Build the full chat tool set as headless `.server()` tools bound to `doc`,
 * recording every call into `record`. Input schemas are serialised from Zod
 * with the library's own `convertSchemaToJsonSchema` (so they match the wire
 * shape the live client sends) and then run through the same provider dialect
 * rewrite the production handler applies — without which Gemini rejects the
 * `propose_changes` `z.literal()` discriminators.
 */
export function buildEvalTools(
	doc: PertDoc,
	record: ToolCall[],
	provider: ProviderName,
): Tool[] {
	const rewrite = rewriteFor(provider);
	return CHAT_TOOL_DEFINITIONS.map((def) => {
		const exec = EXECUTORS[def.name];
		if (!exec) {
			throw new Error(
				`eval harness has no server executor for tool ${def.name}`,
			);
		}
		const json = convertSchemaToJsonSchema(def.inputSchema);
		const inputSchema = rewrite && json ? rewrite(json) : json;
		const tool = {
			name: def.name,
			description: def.description,
			inputSchema,
			__toolSide: "server" as const,
			execute: (args: unknown) => {
				// Contain throws the way the live client's withToolLogging does: a
				// mutator (or applyOperations) that throws becomes an { ok:false }
				// result instead of aborting the whole chat() run, and the failing
				// call is still recorded so the scenario can diagnose it.
				let result: unknown;
				try {
					result = exec(doc, (args ?? {}) as Record<string, unknown>);
				} catch (err) {
					result = {
						ok: false,
						error: err instanceof Error ? err.message : String(err),
					};
				}
				record.push({ name: def.name, args, result });
				return result;
			},
		};
		return tool as unknown as Tool;
	});
}

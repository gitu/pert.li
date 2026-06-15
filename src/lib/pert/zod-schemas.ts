import { z } from "zod";
import type {
	Dependency,
	Estimate,
	Group,
	PertDoc,
	ProjectCalendar,
	ProjectIssueTracker,
	Task,
	ViewState,
	WorkPlan,
} from "./types";

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date (yyyy-mm-dd)");

// Mirror schemas for the PERT domain. Used at boundaries — AI extraction,
// YAML/Markdown import, server fns that synthesise tasks. NOT used to validate
// every `change()` call, since Automerge mutations are local-first hot paths.

export const estimateUnit = z.enum(["hour", "day", "week"]);

export const estimate = z
	.object({
		optimistic: z.number().nonnegative(),
		mostLikely: z.number().nonnegative(),
		pessimistic: z.number().nonnegative(),
		unit: estimateUnit,
	})
	.refine((e) => e.optimistic <= e.mostLikely, {
		message: "optimistic must be <= mostLikely",
		path: ["optimistic"],
	})
	.refine((e) => e.mostLikely <= e.pessimistic, {
		message: "mostLikely must be <= pessimistic",
		path: ["pessimistic"],
	}) satisfies z.ZodType<Estimate>;

export const taskKind = z.enum(["task", "milestone"]);

export const layout = z.object({
	position: z.object({ x: z.number(), y: z.number() }).optional(),
	width: z.number().optional(),
	height: z.number().optional(),
});

export const group: z.ZodType<Group> = z.object({
	id: z.string().min(1),
	name: z.string(),
	parentGroupId: z.string().nullable(),
	order: z.number(),
	layout: layout.optional(),
});

export const taskStatus = z.enum(["not_started", "in_progress", "completed"]);

export const task: z.ZodType<Task> = z.object({
	id: z.string().min(1),
	kind: taskKind,
	title: z.string(),
	groupId: z.string().nullable().optional(),
	numberOverride: z.string().optional(),
	order: z.number().optional(),
	estimate: estimate.optional(),
	notes: z.string().optional(),
	issueKeys: z.array(z.string()).optional(),
	layout: layout.optional(),
	status: taskStatus.optional(),
	progress: z.number().min(0).max(100).optional(),
	actualStart: isoDate.optional(),
	actualFinish: isoDate.optional(),
	metadata: z
		.object({
			confidence: z.number().min(0).max(1).optional(),
			tags: z.array(z.string()).optional(),
			sourceRefs: z
				.array(
					z.object({
						documentId: z.string(),
						page: z.number().int().nonnegative().optional(),
						paragraph: z.number().int().nonnegative().optional(),
						excerptHash: z.string().optional(),
					}),
				)
				.optional(),
		})
		.optional(),
});

export const dependencyPort = z.enum(["start", "finish"]);

export const dependencyEndpoint = z.object({
	taskId: z.string().optional(),
	port: dependencyPort.optional(),
});

export const dependencyType = z.enum([
	"finish_to_start",
	"start_to_start",
	"finish_to_finish",
	"start_to_finish",
]);

export const dependency: z.ZodType<Dependency> = z
	.object({
		id: z.string().min(1),
		from: dependencyEndpoint,
		to: dependencyEndpoint,
		type: dependencyType,
		lagDays: z.number().optional(),
	})
	.refine((d) => d.from.taskId, {
		message: "from must reference a task",
		path: ["from"],
	})
	.refine((d) => d.to.taskId, {
		message: "to must reference a task",
		path: ["to"],
	});

export const viewKind = z.enum(["network", "timeline", "table", "matrix"]);

export const viewState: z.ZodType<ViewState> = z.object({
	id: z.string().min(1),
	kind: viewKind,
	label: z.string().optional(),
});

export const estimateBasis = z.enum(["effort", "duration"]);

export const teamCapacity = z.object({
	peopleCount: z.number().int().min(0),
	availabilityPct: z.number().min(0).max(100),
	useHistoric: z.boolean().optional(),
	estimateBasis: estimateBasis.optional(),
});

export const allocationMode = z.enum(["calendar", "team"]);

export const projectCalendar: z.ZodType<ProjectCalendar> = z.object({
	startDate: isoDate,
	workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
	holidays: z.array(isoDate).optional(),
	team: teamCapacity.optional(),
	allocationMode: allocationMode.optional(),
});

export const projectIssueTracker: z.ZodType<ProjectIssueTracker> = z.object({
	// Reject empty / whitespace-only templates so a persisted issueTracker can't
	// be "effectively unconfigured" (buildIssueUrl trims, and the Overview would
	// otherwise show a misleading "Configured" state). The UI's applyIssueTracker
	// already deletes empties; this guards import / direct-write paths too.
	urlTemplate: z.string().refine((s) => s.trim().length > 0, {
		message: "urlTemplate must not be empty",
	}),
	name: z.string().optional(),
});

export const workPlanStepStatus = z.enum([
	"pending",
	"in_progress",
	"completed",
	"failed",
	"skipped",
]);

export const workPlanStep = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	description: z.string(),
	status: workPlanStepStatus,
	result: z.string().optional(),
});

export const workPlanStatus = z.enum([
	"draft",
	"approved",
	"executing",
	"completed",
	"cancelled",
]);

export const workPlan: z.ZodType<WorkPlan> = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	rationale: z.string(),
	steps: z.array(workPlanStep),
	status: workPlanStatus,
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const pertDoc: z.ZodType<PertDoc> = z.object({
	schemaVersion: z.literal(1),
	title: z.string(),
	tasksById: z.record(z.string(), task),
	groupsById: z.record(z.string(), group),
	dependenciesById: z.record(z.string(), dependency),
	viewsById: z.record(z.string(), viewState),
	calendar: projectCalendar.optional(),
	issueTracker: projectIssueTracker.optional(),
	workPlan: workPlan.optional(),
});

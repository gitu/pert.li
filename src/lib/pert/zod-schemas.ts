import { z } from "zod";
import type {
	ContainerInterface,
	Dependency,
	Estimate,
	PertDoc,
	Task,
	ViewState,
} from "./types";

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

export const taskKind = z.enum(["task", "milestone", "container"]);

export const layout = z.object({
	position: z.object({ x: z.number(), y: z.number() }).optional(),
	collapsed: z.boolean().optional(),
});

export const task: z.ZodType<Task> = z.object({
	id: z.string().min(1),
	kind: taskKind,
	title: z.string(),
	parentId: z.string().nullable(),
	estimate: estimate.optional(),
	notes: z.string().optional(),
	layout: layout.optional(),
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
	interfaceId: z.string().optional(),
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
	.refine((d) => d.from.taskId || d.from.interfaceId, {
		message: "from must reference a task or interface",
		path: ["from"],
	})
	.refine((d) => d.to.taskId || d.to.interfaceId, {
		message: "to must reference a task or interface",
		path: ["to"],
	});

export const interfaceKind = z.enum(["entry", "exit"]);

export const containerInterface: z.ZodType<ContainerInterface> = z.object({
	id: z.string().min(1),
	containerId: z.string().min(1),
	kind: interfaceKind,
	label: z.string(),
	taskRef: z.string().optional(),
});

export const viewKind = z.enum(["network", "timeline", "table", "matrix"]);

export const viewState: z.ZodType<ViewState> = z.object({
	id: z.string().min(1),
	kind: viewKind,
	label: z.string().optional(),
});

export const pertDoc: z.ZodType<PertDoc> = z.object({
	schemaVersion: z.literal(1),
	title: z.string(),
	tasksById: z.record(z.string(), task),
	dependenciesById: z.record(z.string(), dependency),
	interfacesByContainerId: z.record(
		z.string(),
		z.record(z.string(), containerInterface),
	),
	viewsById: z.record(z.string(), viewState),
});

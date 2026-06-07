import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";

// Title used to find-or-create the single shared tutorial project. The
// tutorial card launches every lesson against this project so the assistant
// has a real plan to read, estimate, and modify — its proposals need an active
// project doc to attach to, which the workspace home page otherwise lacks.
export const TUTORIAL_PROJECT_TITLE = "PERT tutorial";

// Reserved thread the home-page tutorial CTAs always land in. Every lesson is
// routed into this single thread (inside the shared tutorial project's scope)
// so repeated clicks continue one conversation instead of littering the tab
// strip with a fresh thread each time. The plain-string id can't collide with
// the UUIDs `newThreadId()` mints for user-created threads.
export const TUTORIAL_THREAD_ID = "tutorial";
export const TUTORIAL_THREAD_TITLE = "Tutorial";

// A small, self-contained sample plan: a website-launch graph with a clear
// critical path (research → design → frontend → integrate → launch) plus a
// parallel backend track that carries slack. Three-point estimates are filled
// in so the schedule, slack, and critical-path overlays all have something to
// show the moment the project opens — the assistant then teaches against it.
//
// Positions are pre-laid left-to-right so the canvas reads cleanly without a
// relayout; nodes are 200×80, columns spaced ~260px apart.
export function createTutorialPertDoc(
	title: string = TUTORIAL_PROJECT_TITLE,
): PertDoc {
	const doc = createEmptyPertDoc(title);

	const at = (x: number, y: number) => ({ position: { x, y } });

	doc.tasksById = {
		research: {
			id: "research",
			kind: "task",
			title: "Research & requirements",
			estimate: { optimistic: 2, mostLikely: 3, pessimistic: 5, unit: "day" },
			notes: "Scope the launch and gather what we need before building.",
			layout: at(0, 120),
		},
		design: {
			id: "design",
			kind: "task",
			title: "Design mockups",
			estimate: { optimistic: 3, mostLikely: 5, pessimistic: 8, unit: "day" },
			layout: at(280, 0),
		},
		infra: {
			id: "infra",
			kind: "task",
			title: "Set up infrastructure",
			estimate: { optimistic: 1, mostLikely: 2, pessimistic: 4, unit: "day" },
			layout: at(280, 240),
		},
		frontend: {
			id: "frontend",
			kind: "task",
			title: "Build frontend",
			estimate: { optimistic: 4, mostLikely: 6, pessimistic: 10, unit: "day" },
			layout: at(560, 0),
		},
		backend: {
			id: "backend",
			kind: "task",
			title: "Build backend",
			estimate: { optimistic: 3, mostLikely: 5, pessimistic: 9, unit: "day" },
			layout: at(560, 240),
		},
		integrate: {
			id: "integrate",
			kind: "task",
			title: "Integrate & test",
			estimate: { optimistic: 2, mostLikely: 4, pessimistic: 6, unit: "day" },
			layout: at(840, 120),
		},
		launch: {
			id: "launch",
			kind: "milestone",
			title: "Launch 🚀",
			layout: at(1120, 120),
		},
	};

	const fs = (id: string, from: string, to: string) => ({
		id,
		from: { taskId: from, port: "finish" as const },
		to: { taskId: to, port: "start" as const },
		type: "finish_to_start" as const,
	});

	doc.dependenciesById = {
		d1: fs("d1", "research", "design"),
		d2: fs("d2", "research", "infra"),
		d3: fs("d3", "design", "frontend"),
		d4: fs("d4", "infra", "backend"),
		d5: fs("d5", "frontend", "integrate"),
		d6: fs("d6", "backend", "integrate"),
		d7: fs("d7", "integrate", "launch"),
	};

	return doc;
}

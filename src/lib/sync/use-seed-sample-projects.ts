import type { Repo } from "@automerge/automerge-repo";
import { useEffect, useRef } from "react";
import { SAMPLE_PROJECTS } from "#/lib/pert/sample-projects";
import type { ProjectSummary } from "#/types/workspace";
import { seedSampleProject } from "./seed-sample-projects";

// Pure gating predicate, extracted so the run-once / empty-only logic is unit
// testable without React. We only auto-seed a workspace that is genuinely empty,
// and only if we haven't already handled it (seeded it, or seen it non-empty).
// "Empty workspace" is the trigger, not "samples missing" — once anything
// exists we leave it alone.
export function shouldSeed(args: {
	repoPresent: boolean;
	projectsSettled: boolean;
	projectCount: number;
	workspaceHandled: boolean;
}): boolean {
	if (args.workspaceHandled) return false;
	if (!args.repoPresent) return false;
	if (!args.projectsSettled) return false;
	return args.projectCount === 0;
}

// Seed the sample projects into an empty workspace the first time it loads.
// Lives in WorkspaceHome (where the projects query is) rather than the global
// reconciler, which has no view of the server project list.
export function useSeedSampleProjects(args: {
	repo: Repo | null | undefined;
	projects: ProjectSummary[];
	// projectsQuery settled successfully — never seed on a pending/error load,
	// or we'd seed a workspace that only *looks* empty.
	projectsSettled: boolean;
	workspaceId?: string;
}): void {
	const { repo, projects, projectsSettled, workspaceId } = args;
	// One entry per workspace we've already acted on — seeded, or observed to
	// already have projects. Keyed (not a single boolean) so switching to a
	// *different* empty workspace still seeds it, while a transient empty render
	// (mid-refetch) or returning to a handled workspace never re-seeds. Persists
	// across the Strict-Mode effect→cleanup→effect cycle; never cleared.
	const handledRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		// A workspace with no resolved id yet (fresh personal workspace) buckets
		// under "". Seeding it without a workspaceId yields globally-visible
		// pending rows, so once the id resolves the workspace reads as non-empty
		// and won't seed again.
		const key = workspaceId ?? "";
		const handled = handledRef.current.has(key);
		if (
			!shouldSeed({
				repoPresent: !!repo,
				projectsSettled,
				projectCount: projects.length,
				workspaceHandled: handled,
			})
		) {
			// A settled, non-empty workspace is handled for good — record it so a
			// later empty render (e.g. a refetch blip) can't seed it.
			if (!handled && repo && projectsSettled && projects.length > 0) {
				handledRef.current.add(key);
			}
			return;
		}
		// Mark synchronously before the first await so a second effect invocation
		// (Strict Mode) or a re-render before `addPending` lands can't re-enter.
		handledRef.current.add(key);
		const activeRepo = repo;
		if (!activeRepo) return;

		void (async () => {
			const present = new Set(projects.map((p) => p.title));
			for (const sample of SAMPLE_PROJECTS) {
				// Belt-and-suspenders: empty workspace means this never skips on the
				// happy path; it only guards the residual unmount/return race.
				if (present.has(sample.title)) continue;
				try {
					await seedSampleProject(
						activeRepo,
						sample.create(),
						sample.title,
						workspaceId,
					);
				} catch {
					// Best-effort: auto-seed must never throw an uncaught rejection
					// (the e2e clean-console fixture treats that as a failure).
				}
			}
		})();
	}, [repo, projects, projectsSettled, workspaceId]);
}

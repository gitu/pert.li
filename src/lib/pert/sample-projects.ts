import type { PertDoc } from "#/lib/pert/types";
import {
	createMonteCarloPertDoc,
	MONTE_CARLO_SAMPLE_TITLE,
} from "./sample-montecarlo-project";
import {
	createTutorialPertDoc,
	TUTORIAL_PROJECT_TITLE,
} from "./sample-tutorial-project";

// The set of sample projects seeded into an empty workspace on first visit.
// Pure data (no React) so the auto-seed hook, tests, and e2e can all import it
// without pulling in route code. Order is the order they appear in the list.
export type SampleProject = {
	title: string;
	create: () => PertDoc;
};

export const SAMPLE_PROJECTS: SampleProject[] = [
	{
		title: TUTORIAL_PROJECT_TITLE,
		create: () => createTutorialPertDoc(TUTORIAL_PROJECT_TITLE),
	},
	{
		title: MONTE_CARLO_SAMPLE_TITLE,
		create: () => createMonteCarloPertDoc(MONTE_CARLO_SAMPLE_TITLE),
	},
];

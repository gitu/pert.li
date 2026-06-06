// Beginner tutorial seed prompts surfaced by both the chat panel's empty
// state and the workspace TutorialCard. Kept in this leaf module (rather than
// exported from the large chat-panel component) so consumers — including the
// workspace home route and its Storybook story — don't transitively pull the
// entire chat/AI-SDK module graph just to read this constant.

export type TutorialSeed = { label: string; prompt: string };

export const TUTORIAL_SEEDS: ReadonlyArray<TutorialSeed> = [
	{
		label: "What is PERT?",
		prompt:
			"I'm new to PERT. Give me a beginner-friendly intro: what it is, what problem it solves, and the few terms I should know (three-point estimate, critical path, slack). Keep it under ~200 words and end by offering to walk me through a concrete example.",
	},
	{
		label: "Three-point estimates",
		prompt:
			"Teach me how three-point estimates (optimistic / most likely / pessimistic) work in PERT. Show the expected duration formula and one concrete worked example. Then ask if I want to try estimating a task of my own.",
	},
	{
		label: "Critical path explained",
		prompt:
			"Explain the critical path in plain language. Use a small 4-task example with dependencies, walk through ES/EF/LS/LF and slack, and call out which path is critical and why.",
	},
	{
		label: "Walk me through pert.li",
		prompt:
			"Walk me through pert.li like a tutorial. Explain the canvas, list, timeline, table, and matrix views; the inspector; and how to create tasks, set estimates, and wire dependencies. Pause for questions after each section.",
	},
];

// Action-oriented prompts that show the assistant can *change* the project —
// not just explain concepts. Surfaced alongside TUTORIAL_SEEDS in the chat
// empty state so users discover that the assistant can add tasks, estimate
// work, build a plan, and analyse the schedule for them. Edits still flow
// through the normal proposal/work-plan approval gates.
export const ACTION_SEEDS: ReadonlyArray<TutorialSeed> = [
	{
		label: "Draft tasks for me",
		prompt:
			"Help me get started: ask me what I'm planning, then propose a first set of tasks and dependencies for it. I'll review your proposal before anything is applied.",
	},
	{
		label: "Estimate a task",
		prompt:
			"I'd like help estimating a task. Ask me which task, then suggest optimistic / most likely / pessimistic values with a short rationale and propose setting them.",
	},
	{
		label: "Build a work plan",
		prompt:
			"Draft a work plan for a project I'll describe, breaking it into ordered steps with dependencies, then show it to me for approval before applying anything.",
	},
	{
		label: "What's on the critical path?",
		prompt:
			"Analyse this project's schedule: read the current tasks, tell me which ones are on the critical path and why, and flag any tasks with a lot of slack.",
	},
];

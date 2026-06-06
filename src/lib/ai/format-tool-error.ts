// Tool calls and edit operations fail with terse, machine-oriented strings
// (e.g. `task abc123 not found`, `optimistic must be <= mostLikely`). Surfacing
// those verbatim in chat reads like a stack trace. formatToolError maps the
// common shapes to a short plain-language sentence; anything unrecognised falls
// through unchanged so we never swallow a novel error. The original string is
// still shown in the expandable tool-call body for debugging — this only
// improves the at-a-glance summary.

type Rule = { test: RegExp; message: string };

// Ordered: first match wins, so put the specific cases before the broad ones.
const RULES: Rule[] = [
	{
		test: /self-dependency is not allowed/i,
		message: "A task can't depend on itself.",
	},
	{
		test: /cannot depend (?:on|from) container/i,
		message:
			"You can't link directly to a container — pick a specific task inside it.",
	},
	{
		test: /would create a cycle|is a cycle|cycle in the hierarchy/i,
		message:
			"That change would create a dependency loop, which can't be scheduled.",
	},
	{
		test: /optimistic must be <= mostLikely|mostLikely must be <= pessimistic/i,
		message:
			"Those estimate values are out of order — they must go optimistic ≤ most likely ≤ pessimistic.",
	},
	{
		test: /actual(?:Start|Finish) must be ISO/i,
		message: "That date isn't valid — use a real calendar date.",
	},
	{
		test: /\bid .* already exists|already exists\b/i,
		message: "Something with that id already exists.",
	},
	{
		test: /(?:is not a container|not a container)/i,
		message: "That target isn't a container.",
	},
	{
		test: /\bcontainer .* not found|parent .* not found/i,
		message: "I couldn't find that container — it may have been deleted.",
	},
	{
		test: /\bdependency .* not found/i,
		message: "That dependency no longer exists.",
	},
	{
		test: /\binterface .* not found/i,
		message: "That connection point no longer exists.",
	},
	{
		test: /\bstep .* not found|step \d+ has an empty title/i,
		message: "That work-plan step is missing or incomplete.",
	},
	{
		test: /\btask .* not found|task id .* not found/i,
		message: "I couldn't find that task — it may have been deleted or renamed.",
	},
	{
		test: /no work plan exists/i,
		message: "There's no work plan yet — create one first.",
	},
	{
		test: /work plan title must not be empty|work plan needs at least one step/i,
		message:
			"That work plan is incomplete — it needs a title and at least one step.",
	},
	{
		test: /different project|wrong project/i,
		message:
			"This was prepared for a different project — open that project to apply it.",
	},
	{
		test: / crashed: /i,
		message: "Something went wrong running that step. Try again.",
	},
	{
		test: /not valid json/i,
		message: "The response wasn't in the expected format. Try again.",
	},
];

export function formatToolError(raw: string | undefined | null): string {
	const text = (raw ?? "").trim();
	if (!text) return "Something went wrong.";
	for (const rule of RULES) {
		if (rule.test.test(text)) return rule.message;
	}
	return text;
}

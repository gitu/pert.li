import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// One-shot, non-streaming project summary. The client computes a compact
// digest of the in-memory Automerge doc (buildProjectDigest) and POSTs it
// here; we wrap it in a focused prompt and return the model's text. Unlike the
// chat handler this takes no tools and doesn't stream — `chat({ stream:false })`
// returns the collected string.
//
// Heavy AI deps are imported lazily inside the handler so the client depscanner
// never walks @tanstack/ai / node:path / dotenv (same pattern as
// src/server/workspace.ts).

// 12_000 digest chars + the builder's "…(truncated)" suffix; a little slack on
// top. Keeps the model context (and the operator's bill) bounded.
const projectSummaryInput = z.object({
	digest: z.string().min(1).max(12_100),
});

const SUMMARY_PROMPT = [
	"You are the project-planning assistant inside pert.li, a PERT/CPM planning",
	"tool. You will be given a compact digest of a single project plan: its key",
	"figures (task/dependency counts, estimated duration, schedule dates,",
	"critical-path size, progress) and an indented outline of its tasks.",
	"",
	"Write a tight executive overview for someone glancing at the project:",
	"  • 3–5 sentences of plain-language summary — what the plan covers, its",
	"    size, schedule, and how far along it is.",
	"  • Then 'Risks:' followed by the top 2–3 risks you can infer from the",
	"    digest (a detected dependency cycle, a long critical path, large",
	"    unscheduled scope, little progress against a near finish date, etc.).",
	"",
	"Be concrete and reference the real figures. Do not invent tasks or numbers",
	"that aren't in the digest. Use Markdown. Keep it under ~180 words. Do not",
	"ask follow-up questions or address the user directly.",
].join("\n");

export const generateProjectSummary = createServerFn({ method: "POST" })
	.inputValidator(projectSummaryInput)
	.handler(async ({ data }) => {
		// Gate on a session — the adapter spends the operator's provider key, so
		// anonymous callers must not be able to burn it.
		const [
			{ requireSession },
			{ chat },
			{ selectTextAdapter },
			{ SERVER_ENV },
		] = await Promise.all([
			import("#/server/auth-context.server.ts"),
			import("@tanstack/ai"),
			import("#/lib/ai/provider"),
			import("#/lib/ai/chat.server"),
		]);
		await requireSession();
		const { adapter } = selectTextAdapter(SERVER_ENV);
		const summary = await chat({
			adapter,
			systemPrompts: [SUMMARY_PROMPT],
			messages: [{ role: "user", content: data.digest }],
			stream: false,
		});
		return { summary };
	});

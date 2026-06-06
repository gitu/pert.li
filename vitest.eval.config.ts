import { defineConfig } from "vitest/config";

// Dedicated config for the live LLM eval suite (src/lib/ai/eval/scenarios/*.eval.ts).
// Kept separate from vitest.config.ts on purpose: the main config's `include`
// is scoped to `*.test.ts`, so these `*.eval.ts` files are invisible to
// `pnpm test` (which runs with a placeholder API key in CI and must never make
// real model calls). Run the evals explicitly with `pnpm eval` and a real
// provider key in env — see SELF_HOSTING.md § Evals.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["src/lib/ai/eval/scenarios/**/*.eval.ts"],
		setupFiles: ["./src/test/setup-dom.ts"],
		// Clears the JSONL score sink once before the run (see report.ts).
		globalSetup: ["./src/lib/ai/eval/global-setup.ts"],
		// Live model calls inside repeat() loops are slow — give each scenario
		// generous headroom (default 5s would fail instantly).
		testTimeout: 600_000,
		hookTimeout: 60_000,
		// Run scenario files sequentially so we don't fan out concurrent model
		// calls into provider rate limits, and the streamed progress stays legible.
		fileParallelism: false,
		reporters: [
			"default",
			["json", { outputFile: "eval-report/results.json" }],
		],
	},
});

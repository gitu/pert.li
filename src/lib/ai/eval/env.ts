import { resolve } from "node:path";
import dotenv from "dotenv";
import type { ProviderEnv } from "../provider";

// Resolve the eval suite's provider env from the same sources the dev server
// uses, so `pnpm eval` picks up the project's LOCAL config out of the box
// (LLM_PROVIDER / LLM_MODEL / OPENAI_BASE_URL / *_API_KEY) without anyone
// having to re-export it. Mirrors chat.server.ts's SERVER_ENV merge, but lives
// here so the harness stays free of the server/auth/db graph.
//
// Merge order (later wins): process.env → .env → .env.local. So CI's exported
// secrets are the baseline and a developer's .env.local overrides locally.
const rootDir = process.env.PROJECT_ROOT ?? process.cwd();
const dotEnv =
	dotenv.config({ path: resolve(rootDir, ".env"), quiet: true }).parsed ?? {};
const dotEnvLocal =
	dotenv.config({ path: resolve(rootDir, ".env.local"), quiet: true }).parsed ??
	{};

export const EVAL_ENV: ProviderEnv = {
	...(process.env as ProviderEnv),
	...dotEnv,
	...dotEnvLocal,
};

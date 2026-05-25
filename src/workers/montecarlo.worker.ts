/// <reference lib="webworker" />

import type {
	MonteCarloOptions,
	MonteCarloResult,
} from "#/lib/pert/montecarlo";
import { runMonteCarlo } from "#/lib/pert/montecarlo";
import type { PertDoc } from "#/lib/pert/types";

// Web Worker that runs the Monte Carlo simulator off the main thread. The UI
// posts `{ id, doc, options }` and gets `{ id, result }` back. We keep the
// protocol intentionally tiny — no shared mutable state, no Comlink.

type RunMessage = {
	id: number;
	doc: PertDoc;
	options?: MonteCarloOptions;
};

type ResultMessage = {
	id: number;
	result: MonteCarloResult | null;
};

self.onmessage = (ev: MessageEvent<RunMessage>) => {
	const { id, doc, options } = ev.data;
	const result = runMonteCarlo(doc, options);
	const reply: ResultMessage = { id, result };
	(self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};

export type { ResultMessage, RunMessage };

import { useEffect, useRef, useState } from "react";
import type {
	MonteCarloOptions,
	MonteCarloResult,
} from "#/lib/pert/montecarlo";
import { runMonteCarlo } from "#/lib/pert/montecarlo";
import type { PertDoc } from "#/lib/pert/types";

// Debounced Monte Carlo runner.
//
// Strategy:
//   • Defer until the doc has been quiet for `debounceMs` — we don't want to
//     re-simulate on every keystroke.
//   • Run inside a Web Worker so a 2k-trial simulation doesn't stall the
//     canvas. In SSR / Storybook / Node tests, fall back to running inline.
//   • Discard stale replies via a monotonically increasing request id.
//
// The result is intentionally optional — callers must handle `null` (cycle in
// graph, worker unavailable, first frame before debounce elapses).

type Options = MonteCarloOptions & { debounceMs?: number };

type State = {
	result: MonteCarloResult | null;
	running: boolean;
	error: string | null;
};

const DEFAULT_DEBOUNCE = 300;

type WorkerHandle = {
	worker: Worker;
	pending: Map<number, (result: MonteCarloResult | null) => void>;
};

function createWorker(): WorkerHandle | null {
	if (typeof Worker === "undefined") return null;
	try {
		const worker = new Worker(
			new URL("../../workers/montecarlo.worker.ts", import.meta.url),
			{ type: "module" },
		);
		const pending = new Map<
			number,
			(result: MonteCarloResult | null) => void
		>();
		worker.onmessage = (ev: MessageEvent) => {
			const { id, result } = ev.data as {
				id: number;
				result: MonteCarloResult | null;
			};
			const resolver = pending.get(id);
			if (!resolver) return;
			pending.delete(id);
			resolver(result);
		};
		return { worker, pending };
	} catch {
		return null;
	}
}

export function useMonteCarlo(
	doc: PertDoc | null | undefined,
	options: Options = {},
): State {
	const [state, setState] = useState<State>({
		result: null,
		running: false,
		error: null,
	});
	const workerRef = useRef<WorkerHandle | null>(null);
	const requestIdRef = useRef(0);
	const lastDocRef = useRef<PertDoc | undefined>(undefined);

	useEffect(() => {
		if (!workerRef.current) workerRef.current = createWorker();
		return () => {
			workerRef.current?.worker.terminate();
			workerRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!doc) return;
		lastDocRef.current = doc;
		const debounce = options.debounceMs ?? DEFAULT_DEBOUNCE;
		const timer = setTimeout(() => {
			requestIdRef.current += 1;
			const reqId = requestIdRef.current;
			setState((prev) => ({ ...prev, running: true, error: null }));
			const handle = workerRef.current;
			const runOptions: MonteCarloOptions = {
				trials: options.trials,
				seed: options.seed,
				lambda: options.lambda,
			};
			if (handle) {
				handle.pending.set(reqId, (result) => {
					if (reqId !== requestIdRef.current) return;
					setState({ result, running: false, error: null });
				});
				handle.worker.postMessage({ id: reqId, doc, options: runOptions });
			} else {
				try {
					const result = runMonteCarlo(doc, runOptions);
					if (reqId === requestIdRef.current) {
						setState({ result, running: false, error: null });
					}
				} catch (err) {
					setState({
						result: null,
						running: false,
						error: err instanceof Error ? err.message : "Monte Carlo failed",
					});
				}
			}
		}, debounce);
		return () => clearTimeout(timer);
		// We intentionally re-run on every doc change. The debounce above is
		// what keeps this from saturating the worker during rapid edits.
	}, [doc, options.trials, options.seed, options.lambda, options.debounceMs]);

	return state;
}

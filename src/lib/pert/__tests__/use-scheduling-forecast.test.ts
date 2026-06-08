// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonteCarloResult } from "../montecarlo";
import type { PertDoc } from "../types";
import { createEmptyPertDoc } from "../types";
import { useSchedulingForecast } from "../use-scheduling-forecast";

// Isolate the fake-delay "calculating" gate from the (already-tested) Monte
// Carlo engine. The mock is controllable so we can simulate a run still in
// flight (`running`) or a run that settled with no result (a dependency cycle).
const FAKE_RESULT = { trials: 2000 } as unknown as MonteCarloResult;

const mc = {
	running: false,
	resultWhenDoc: FAKE_RESULT as MonteCarloResult | null,
};

vi.mock("../use-monte-carlo", () => ({
	useMonteCarlo: (doc: PertDoc | null | undefined) => ({
		result: doc ? mc.resultWhenDoc : null,
		running: mc.running,
		error: null,
	}),
}));

const est = {
	optimistic: 1,
	mostLikely: 2,
	pessimistic: 4,
	unit: "day" as const,
};

function docWithWork(): PertDoc {
	const d = createEmptyPertDoc("p");
	d.tasksById = {
		t1: { id: "t1", kind: "task", title: "A", estimate: est },
	};
	return d;
}

describe("useSchedulingForecast", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mc.running = false;
		mc.resultWhenDoc = FAKE_RESULT;
	});
	afterEach(() => vi.useRealTimers());

	it("holds a calculating state until the 1–2s window elapses, then reveals", () => {
		// Stable doc reference — in production `doc` only changes identity on an
		// actual edit, so the reveal timer isn't re-armed on every re-render.
		const doc = docWithWork();
		const { result } = renderHook(() => useSchedulingForecast(doc));

		// Immediately on mount: spinning, no result yet.
		expect(result.current.calculating).toBe(true);
		expect(result.current.result).toBeNull();
		expect(result.current.empty).toBe(false);

		// Still calculating just before the minimum delay.
		act(() => {
			vi.advanceTimersByTime(900);
		});
		expect(result.current.calculating).toBe(true);
		expect(result.current.result).toBeNull();

		// Past the maximum delay: revealed.
		act(() => {
			vi.advanceTimersByTime(1200);
		});
		expect(result.current.calculating).toBe(false);
		expect(result.current.result).toBe(FAKE_RESULT);
	});

	it("re-enters the calculating state when the doc changes", () => {
		const { result, rerender } = renderHook(
			({ doc }: { doc: PertDoc }) => useSchedulingForecast(doc),
			{ initialProps: { doc: docWithWork() } },
		);
		act(() => {
			vi.advanceTimersByTime(2100);
		});
		expect(result.current.calculating).toBe(false);

		// A fresh doc identity (an Automerge edit) re-arms the spinner.
		rerender({ doc: docWithWork() });
		expect(result.current.calculating).toBe(true);
		act(() => {
			vi.advanceTimersByTime(2100);
		});
		expect(result.current.calculating).toBe(false);
		expect(result.current.result).toBe(FAKE_RESULT);
	});

	it("keeps spinning past the delay until the underlying run actually finishes", () => {
		// The simulation is still in flight when the artificial window elapses —
		// we must not reveal the previous run's (stale) numbers early.
		mc.running = true;
		const doc = docWithWork();
		const { result, rerender } = renderHook(() => useSchedulingForecast(doc));

		act(() => {
			vi.advanceTimersByTime(2100);
		});
		expect(result.current.calculating).toBe(true);
		expect(result.current.result).toBeNull();

		// Run settles → reveal.
		mc.running = false;
		act(() => {
			rerender();
		});
		expect(result.current.calculating).toBe(false);
		expect(result.current.result).toBe(FAKE_RESULT);
	});

	it("settles to a null result (unavailable, not a spinner) on a cycle", () => {
		// runMonteCarlo returns null for a dependency cycle; the gate must still
		// resolve so the UI can show an "unavailable" message instead of spinning.
		mc.resultWhenDoc = null;
		const doc = docWithWork();
		const { result } = renderHook(() => useSchedulingForecast(doc));

		act(() => {
			vi.advanceTimersByTime(2100);
		});
		expect(result.current.calculating).toBe(false);
		expect(result.current.result).toBeNull();
		expect(result.current.empty).toBe(false);
	});

	it("is empty (no spinner) when the doc has no estimable tasks", () => {
		const { result } = renderHook(() =>
			useSchedulingForecast(createEmptyPertDoc("blank")),
		);
		expect(result.current.empty).toBe(true);
		expect(result.current.calculating).toBe(false);
		expect(result.current.result).toBeNull();
	});
});

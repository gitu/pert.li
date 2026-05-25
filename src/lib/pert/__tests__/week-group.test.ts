import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { TimelineLane } from "../timeline";
import { groupLanesByWeek, mondayOfWeek } from "../week-group";

function lane(taskId: string, earliestFinishDate: string): TimelineLane {
	return {
		taskId,
		title: taskId,
		kind: "task",
		earliestStart: 0,
		earliestFinish: 1,
		duration: 1,
		slack: 0,
		critical: false,
		status: "not_started",
		progress: 0,
		earliestStartDate: earliestFinishDate,
		earliestFinishDate,
	};
}

describe("mondayOfWeek", () => {
	test("a Monday returns itself", () => {
		expect(mondayOfWeek("2026-05-25")).toBe("2026-05-25");
	});

	test("days within the week resolve to the same Monday", () => {
		for (const d of [
			"2026-05-25", // Mon
			"2026-05-26", // Tue
			"2026-05-28", // Thu
			"2026-05-31", // Sun
		]) {
			expect(mondayOfWeek(d)).toBe("2026-05-25");
		}
	});

	test("crosses year boundaries via the ISO definition", () => {
		// 2024-01-01 is a Monday → same week.
		expect(mondayOfWeek("2024-01-01")).toBe("2024-01-01");
		// 2024-12-31 (Tuesday) belongs to the week starting Mon 2024-12-30.
		expect(mondayOfWeek("2024-12-31")).toBe("2024-12-30");
	});
});

describe("groupLanesByWeek", () => {
	test("empty in → empty out", () => {
		expect(groupLanesByWeek([])).toEqual([]);
	});

	test("buckets lanes from the same ISO week together", () => {
		const groups = groupLanesByWeek([
			lane("A", "2026-05-25"),
			lane("B", "2026-05-27"),
			lane("C", "2026-06-01"),
		]);
		expect(groups).toHaveLength(2);
		expect(groups[0].weekStart).toBe("2026-05-25");
		expect(groups[0].lanes.map((l) => l.taskId)).toEqual(["A", "B"]);
		expect(groups[1].weekStart).toBe("2026-06-01");
		expect(groups[1].lanes.map((l) => l.taskId)).toEqual(["C"]);
	});

	test("property: every input lane appears in exactly one group", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc
							.string({ minLength: 1, maxLength: 5 })
							.filter((s) => /^[a-z0-9]+$/i.test(s)),
						daysFromEpoch: fc.integer({ min: 0, max: 365 * 50 }),
					}),
					{ maxLength: 30 },
				),
				(inputs) => {
					const lanes = inputs.map((i, idx) => {
						const date = new Date(Date.UTC(2026, 0, 1));
						date.setUTCDate(date.getUTCDate() + i.daysFromEpoch);
						const iso = date.toISOString().slice(0, 10);
						return lane(`${i.id}-${idx}`, iso);
					});
					const groups = groupLanesByWeek(lanes);
					const flattened = groups.flatMap((g) => g.lanes);
					expect(flattened).toHaveLength(lanes.length);
					expect(new Set(flattened.map((l) => l.taskId))).toEqual(
						new Set(lanes.map((l) => l.taskId)),
					);
				},
			),
		);
	});

	test("property: groups are date-sorted ascending", () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 0, max: 365 * 10 }), { maxLength: 20 }),
				(offsets) => {
					const lanes = offsets.map((o, idx) => {
						const date = new Date(Date.UTC(2026, 0, 1));
						date.setUTCDate(date.getUTCDate() + o);
						return lane(`t${idx}`, date.toISOString().slice(0, 10));
					});
					const groups = groupLanesByWeek(lanes);
					for (let i = 1; i < groups.length; i++) {
						expect(groups[i - 1].weekStart < groups[i].weekStart).toBe(true);
					}
				},
			),
		);
	});
});

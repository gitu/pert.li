import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { DiffBody } from "../diff-body";

describe("DiffBody", () => {
	it("renders notes diffs as wrapped text instead of truncating", () => {
		const before = createEmptyPertDoc("Before");
		before.tasksById.A = {
			id: "A",
			kind: "task",
			title: "Task A",
			parentId: null,
			notes: "Old line 1\nOld line 2",
		};
		const after = createEmptyPertDoc("After");
		after.tasksById.A = {
			id: "A",
			kind: "task",
			title: "Task A",
			parentId: null,
			notes: "New line 1\nNew line 2",
		};

		render(<DiffBody before={before} after={after} actionMode="view" />);

		const row = screen.getByTestId("diff-field-notes");
		const valueWrap = row.querySelector("div");
		const [beforeValue, , afterValue] = valueWrap?.querySelectorAll("span") ?? [];
		expect(beforeValue?.className).toContain("whitespace-pre-wrap");
		expect(beforeValue?.className).not.toContain("truncate");
		expect(afterValue?.className).toContain("whitespace-pre-wrap");
		expect(afterValue?.className).not.toContain("truncate");
		expect(screen.getByText("Old line 1\nOld line 2")).toBeInTheDocument();
		expect(screen.getByText("New line 1\nNew line 2")).toBeInTheDocument();
	});
});

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { withInputValidation } from "../tool-validate";

const addTaskSchema = z.object({
	taskId: z.string(),
	title: z.string().min(1),
});

describe("withInputValidation", () => {
	it("rejects args that fail the schema without calling the handler", async () => {
		const execute = vi.fn((_args: unknown) => ({ ok: true as const }));
		const tool = withInputValidation({
			name: "add_task",
			inputSchema: addTaskSchema,
			execute,
		});
		// Missing `title` — the exact class of bad input (an absent required field)
		// that would otherwise reach the mutator as `undefined` and crash Automerge.
		const result = (await tool.execute?.({ taskId: "t1" })) as {
			ok: boolean;
			error: string;
		};
		expect(execute).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.error).toContain("Invalid arguments for add_task");
		expect(result.error).toContain("title");
	});

	it("forwards parsed (unknown-key-stripped) data on success", async () => {
		const execute = vi.fn((args: unknown) => ({ ok: true as const, args }));
		const tool = withInputValidation({
			name: "add_task",
			inputSchema: addTaskSchema,
			execute,
		});
		const result = await tool.execute?.({
			taskId: "t1",
			title: "Hello",
			stray: "drop me",
		});
		// Handler runs with the stray key stripped out.
		expect(execute).toHaveBeenCalledWith({ taskId: "t1", title: "Hello" });
		expect(result).toEqual({
			ok: true,
			args: { taskId: "t1", title: "Hello" },
		});
	});

	it("passes through tools without an executor", () => {
		const tool = { name: "noop", inputSchema: addTaskSchema };
		expect(withInputValidation(tool)).toBe(tool);
	});

	it("passes through tools without a schema", () => {
		const execute = vi.fn();
		const tool = { name: "noschema", execute };
		expect(withInputValidation(tool)).toBe(tool);
	});

	it("reports every failing field", async () => {
		const execute = vi.fn((_args: unknown) => undefined);
		const tool = withInputValidation({
			name: "add_task",
			inputSchema: addTaskSchema,
			execute,
		});
		const result = (await tool.execute?.({})) as unknown as { error: string };
		expect(result.error).toContain("taskId");
		expect(result.error).toContain("title");
	});
});

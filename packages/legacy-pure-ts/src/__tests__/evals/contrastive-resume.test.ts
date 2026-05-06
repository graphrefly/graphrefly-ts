import { describe, expect, it } from "vitest";
import {
	type ContrastiveResumeConfig,
	sliceContrastiveTasksForResume,
} from "../../../../../evals/lib/contrastive.js";
import type { EvalTask } from "../../../../../evals/lib/types.js";

const tasks: EvalTask[] = [
	{
		id: "a",
		category: "linear",
		nl_description: "x",
		complexity: "low",
	},
	{
		id: "b",
		category: "linear",
		nl_description: "y",
		complexity: "low",
	},
	{
		id: "c",
		category: "linear",
		nl_description: "z",
		complexity: "low",
	},
];

describe("sliceContrastiveTasksForResume", () => {
	it("returns full list when no resume options", () => {
		const cfg: ContrastiveResumeConfig = {};
		expect(sliceContrastiveTasksForResume(tasks, cfg)).toEqual(tasks);
	});

	it("slices from EVAL_L0_FROM (inclusive)", () => {
		const cfg: ContrastiveResumeConfig = { l0FromTaskId: "b" };
		expect(sliceContrastiveTasksForResume(tasks, cfg)).toEqual([tasks[1], tasks[2]]);
	});

	it("slices after EVAL_L0_AFTER (exclusive)", () => {
		const cfg: ContrastiveResumeConfig = { l0ResumeAfterTaskId: "b" };
		expect(sliceContrastiveTasksForResume(tasks, cfg)).toEqual([tasks[2]]);
	});

	it("rejects unknown task id", () => {
		const cfg: ContrastiveResumeConfig = { l0FromTaskId: "nope" };
		expect(() => sliceContrastiveTasksForResume(tasks, cfg)).toThrow(/unknown task id/);
	});

	it("rejects both from and after", () => {
		const cfg: ContrastiveResumeConfig = {
			l0FromTaskId: "a",
			l0ResumeAfterTaskId: "b",
		};
		expect(() => sliceContrastiveTasksForResume(tasks, cfg)).toThrow(/only one of/);
	});
});

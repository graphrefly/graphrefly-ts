import { describe, expect, it } from "vitest";
import {
	D64_LIVE_EXECUTION_MANIFEST_DIGEST,
	measureD64LiveExecution,
} from "../../evals/empirical-memory-rerun-avoidance/d64-live-execution-manifest.js";

describe("graphrefly-ts:D64 live execution closure", () => {
	it("freezes the D63 qualification, live gates and single-use runner", async () => {
		expect(await measureD64LiveExecution()).toBe(D64_LIVE_EXECUTION_MANIFEST_DIGEST);
	});
});

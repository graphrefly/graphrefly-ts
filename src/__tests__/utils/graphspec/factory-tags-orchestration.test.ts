/**
 * Tier 1.5.3 Phase 2.5 — factory tagging for orchestration-layer factories.
 *
 * Verifies that each Graph-returning factory in this slice (`cqrs`,
 * `jobFlow`) calls `g.tagFactory(...)` so `graph.describe()` surfaces
 * `factory` + `factoryArgs` provenance. `factoryArgs` is routed through
 * `placeholderArgs` (DG2=ii) for non-JSON fields, so we only assert
 * presence + select primitive fields rather than deep equality.
 *
 * NOTE: `processManager` does NOT return a Graph (it returns a
 * `ProcessManagerResult` and mounts on a host `CqrsGraph`), so it is
 * intentionally excluded from this slice — there is no Graph instance
 * to tag.
 */

import { describe, expect, it } from "vitest";
import { cqrs } from "../../../utils/cqrs/index.js";
import { jobFlow } from "../../../utils/job-queue/index.js";

describe("Tier 1.5.3 Phase 2.5 — factory tags (orchestration)", () => {
	it("cqrs tags the CqrsGraph with factory='cqrs' and factoryArgs", () => {
		const g = cqrs("orders", {
			retainedLimit: 256,
			freezeCommandPayload: false,
			maxAggregates: 500,
		});

		const out = g.describe();
		expect(out.factory).toBe("cqrs");
		expect(out.factoryArgs).toBeDefined();
		const args = out.factoryArgs as Record<string, unknown>;
		expect(args.retainedLimit).toBe(256);
		expect(args.freezeCommandPayload).toBe(false);
		expect(args.maxAggregates).toBe(500);
	});

	it("cqrs tags with no opts — factoryArgs is the empty placeholder object", () => {
		const g = cqrs("bare");
		const out = g.describe();
		expect(out.factory).toBe("cqrs");
		expect(out.factoryArgs).toEqual({});
	});

	it("jobFlow tags the JobFlowGraph with factory='jobFlow' and factoryArgs", () => {
		const g = jobFlow<{ id: string }>("flow", {
			stages: ["incoming", { name: "processing", work: async (env) => env.payload }, "done"],
			maxPerPump: 64,
		});

		const out = g.describe();
		expect(out.factory).toBe("jobFlow");
		expect(out.factoryArgs).toBeDefined();
		const args = out.factoryArgs as Record<string, unknown>;
		expect(args.maxPerPump).toBe(64);
		// `stages` walked by placeholderArgs: strings stay strings, the
		// processing entry's `work` becomes "<function>".
		const stages = args.stages as Array<unknown>;
		expect(stages[0]).toBe("incoming");
		expect(stages[1]).toEqual({
			name: "processing",
			work: "<function>",
		});
		expect(stages[2]).toBe("done");
	});
});

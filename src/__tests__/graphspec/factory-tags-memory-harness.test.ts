/**
 * Tier 1.5.3 Phase 2.5 — factory tagging for memory + harness + agent factories.
 *
 * Verifies that each Graph-returning factory (`agentMemory`, `harnessLoop`,
 * `agentLoop`) calls `g.tagFactory(...)` so `graph.describe()` surfaces
 * `factory` + `factoryArgs` provenance. `factoryArgs` is routed through
 * `placeholderArgs` (DG2=ii) for non-JSON fields, so we only assert
 * presence + select primitive fields rather than deep equality.
 */

import { describe, expect, it } from "vitest";
import { agentLoop } from "../../patterns/ai/presets/agent-loop.js";
import { agentMemory } from "../../patterns/ai/presets/agent-memory.js";
import { harnessLoop } from "../../patterns/harness/presets/harness-loop.js";
import { mockLLM } from "../helpers/mock-llm.js";

describe("Tier 1.5.3 Phase 2.5 — factory tags (memory + harness + agent)", () => {
	it("agentMemory tags the Graph with factory='agentMemory' and factoryArgs", () => {
		const g = agentMemory<string>("mem", null, {
			score: () => 1,
			cost: () => 1,
			budget: 1000,
			extractFn: () => ({ upsert: [] }),
		});

		const out = g.describe();
		expect(out.factory).toBe("agentMemory");
		expect(out.factoryArgs).toBeDefined();
		const args = out.factoryArgs as Record<string, unknown>;
		// JSON-friendly primitives survive placeholderArgs verbatim.
		expect(args.budget).toBe(1000);
		// Function-typed args become "<function>" placeholders.
		expect(args.extractFn).toBe("<function>");
		expect(args.score).toBe("<function>");
		expect(args.cost).toBe("<function>");
	});

	it("harnessLoop tags the HarnessGraph with factory='harnessLoop' and factoryArgs", () => {
		const adapter = mockLLM();
		const g = harnessLoop("h", {
			adapter,
			maxRetries: 3,
		});

		const out = g.describe();
		expect(out.factory).toBe("harnessLoop");
		expect(out.factoryArgs).toBeDefined();
		const args = out.factoryArgs as Record<string, unknown>;
		expect(args.maxRetries).toBe(3);
		// adapter is an object with function members → placeholder-walked into
		// a nested object (e.g. `{ invoke: "<function>", ... }`).
		expect(typeof args.adapter).toBe("object");
	});

	it("agentLoop tags the AgentLoopGraph with factory='agentLoop' and factoryArgs", () => {
		const adapter = mockLLM();
		const g = agentLoop("a", {
			adapter,
			maxTurns: 5,
		});

		const out = g.describe();
		expect(out.factory).toBe("agentLoop");
		expect(out.factoryArgs).toBeDefined();
		const args = out.factoryArgs as Record<string, unknown>;
		expect(args.maxTurns).toBe(5);
		expect(typeof args.adapter).toBe("object");
	});
});

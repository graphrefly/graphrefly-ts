/**
 * Tier 1.5.3 Phase 2.5 — factory tagging for audit-layer factories.
 *
 * Mirrors `factory-tags-orchestration.test.ts`. Verifies that `policyGate`
 * (the renamed-from-`policyEnforcer` ABAC factory shipped in Tier 2.3)
 * self-tags via `g.tagFactory("policyGate", placeholderArgs(opts))` so
 * `graph.describe()` surfaces `factory: "policyGate"` provenance.
 *
 * `factoryArgs` is routed through `placeholderArgs` (DG2=ii) for non-JSON
 * fields, so we assert presence + select primitive fields rather than deep
 * equality.
 */

import { describe, expect, it } from "vitest";
import { node } from "../../core/node.js";

import { Graph } from "../../graph/index.js";
import { policyGate } from "../../patterns/inspect/audit.js";

describe("Tier 1.5.3 Phase 2.5 — factory tags (audit)", () => {
	it("policyGate tags the PolicyGateGraph with factory='policyGate' and factoryArgs", () => {
		const target = new Graph("target");
		target.add(node([], { name: "x", initial: 0 }), { name: "x" });

		const gate = policyGate(target, [{ effect: "allow", action: "write" }], {
			mode: "audit",
			violationsLimit: 256,
			name: "guard",
		});

		const out = gate.describe();
		expect(out.factory).toBe("policyGate");
		expect(out.factoryArgs).toBeDefined();
		const args = out.factoryArgs as Record<string, unknown>;
		expect(args.mode).toBe("audit");
		expect(args.violationsLimit).toBe(256);
		expect(args.name).toBe("guard");
	});

	it("policyGate tags with default opts — factoryArgs is the empty placeholder object", () => {
		const target = new Graph("target");
		target.add(node([], { name: "x", initial: 0 }), { name: "x" });

		const gate = policyGate(target, []);
		const out = gate.describe();
		expect(out.factory).toBe("policyGate");
		expect(out.factoryArgs).toEqual({});
	});
});

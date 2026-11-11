/**
 * D797 review regressions on the node surface: a plain node has no public write (graphrefly-ts:D175,
 * REVIEW-D797-migration-fable 2.13).
 */

import { describe, expect, it } from "vitest";
import { graph } from "../index.js";

describe("node surface (D797 review)", () => {
	it("a plain node exposes no batch entry that writes into it (fable 2.13)", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		const d = g.node<number>([s], () => {}, { name: "d" });
		for (const name of [
			"__commitBatchedWave",
			"__markBatchedWave",
			"__resolveBatchedWave",
			"__deferBoundary",
			"down",
		])
			expect(name in d, name).toBe(false);
	});
});

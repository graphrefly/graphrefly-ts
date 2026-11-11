/**
 * D797 review regressions on the node surface: a plain node has no public write (graphrefly-ts:D175,
 * REVIEW-D797-migration-fable 2.13), and a node's definition gives what R-node@2 lists (fable 2.16,
 * codex F12).
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

	it("definition gives declared deps, function, setup, recipe and the policies (fable 2.16)", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		const fn = () => {};
		const setup = () => undefined;
		const q = g.node<number>([s], fn, {
			name: "q",
			quiet: true,
			complete: "manual",
			error: "manual",
			invalidate: "manual",
			setup,
			recipe: { ref: "test", config: null },
		});
		expect(g.definition(q)).toEqual({
			deps: [s],
			fn,
			setup,
			recipe: { ref: "test", config: null },
			complete: "manual",
			error: "manual",
			invalidate: "manual",
			quiet: true,
		});
		const d = g.node<number>([s], fn, { name: "d" });
		expect(g.definition(d)).toMatchObject({
			complete: "auto",
			error: "auto",
			invalidate: "auto",
			quiet: false,
		});
		const next = () => {};
		g.replace(d, [s], next);
		expect(g.definition(d)).toMatchObject({ fn: next, setup: undefined, recipe: undefined });
	});
});

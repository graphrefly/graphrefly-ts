/** No-I/O mechanism probe, not a qualified causal authority or host implementation. */
import { expect, it } from "vitest";
import { depBatch } from "../ctx/types.js";
import {
	ColdConstructionError,
	prepareConstruction,
	startConstruction,
} from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";

for (const closingEdge of ["receipt-to-guard", "authority-to-receipt"] as const) {
	it(`rejects the proposed quiet outcome cycle while cold: ${closingEdge}`, () => {
		const graph = new Graph();
		const input = graph.node([], null, { name: "input" });
		const baseline = graph.describe();
		const scope = prepareConstruction(graph, {
			name: "probe",
			epoch: 1,
			inputs: [input],
			names: ["probe/startup", "receipt", "authority", "guard", "controller"],
		});
		scope.startupSource();
		let invocations = 0;
		const fn = () => {
			invocations++;
		};
		const pullId = Symbol("receipt");
		const authority = scope.node([input], fn, { name: "authority", partial: true });
		const guard = scope.node([authority], fn, { name: "guard" });
		const receipt = scope.node(closingEdge === "receipt-to-guard" ? [] : [guard], null, {
			name: "receipt",
			pullId,
		});
		scope.node([guard, receipt], fn, { name: "controller", partial: true });
		if (closingEdge === "receipt-to-guard") authority.replaceDeps([input, receipt], fn);
		let failure: unknown;
		try {
			if (closingEdge === "receipt-to-guard") receipt.replaceDeps([guard], null);
			else authority.replaceDeps([input, receipt], fn);
		} catch (error) {
			failure = error;
		}
		expect(String(failure)).toContain("would create a cycle");
		expect(invocations).toBe(0);
		expect(() => scope.abort(failure)).toThrow(ColdConstructionError);
		expect(graph.describe()).toEqual(baseline);
	});
}

it("delivers a bounded receipt frame through quiet/PULL in an acyclic cold graph", () => {
	const graph = new Graph();
	const input = graph.node<number>([], null, { name: "input" });
	const scope = prepareConstruction(graph, {
		name: "positive",
		epoch: 1,
		inputs: [input],
		names: ["positive/startup", "result", "receipt", "controller"],
	});
	const startup = scope.startupSource();
	const result = scope.node<readonly number[]>(
		[input],
		(ctx) => {
			const values = depBatch(ctx, 0);
			if (values?.length) ctx.down([["DATA", Object.freeze([...values])]]);
		},
		{ name: "result" },
	);
	const pullId = Symbol("positive-receipt");
	const receipt = scope.node([result], null, { name: "receipt", pullId });
	const received: unknown[] = [];
	const controller = scope.node(
		[result, receipt],
		(ctx) => {
			for (const frame of depBatch(ctx, 1) ?? []) received.push(frame);
			if (depBatch(ctx, 0)?.length) ctx.upNext([["PULL", { pullId }]], 1);
		},
		{ name: "controller", partial: true },
	);
	const owner = scope.seal(startup, [controller]);
	scope.transferToGraph(owner);
	try {
		startConstruction(graph, owner);
		expect(owner.phase).toBe("started");
		expect(received).toEqual([]);
		input.down([
			["DATA", 1],
			["DATA", 2],
		]);
		expect(received).toEqual([[1, 2]]);
	} finally {
		for (const root of owner.roots) root.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const node of owner.nodes) group.add(node);
		group.release();
	}
});

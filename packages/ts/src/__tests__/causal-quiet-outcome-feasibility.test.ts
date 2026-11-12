/** No-I/O mechanism probe, not a qualified causal authority or host implementation. */
import { expect, it } from "vitest";
import { depBatch } from "../ctx/types.js";
import {
	ColdConstructionError,
	prepareConstruction,
	startConstruction,
} from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";
import { rewireOwnedNode } from "./helpers/owned-rewire.js";

for (const closingEdge of ["receipt-to-guard", "authority-to-receipt"] as const) {
	it(`rejects the proposed quiet outcome cycle while cold: ${closingEdge}`, () => {
		const graph = new Graph();
		const input = graph.node([], null, { name: "input" });
		const baseline = graph.inspect();
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
		const authority = scope.node([input], fn, { name: "authority" });
		const guard = scope.node([authority], fn, { name: "guard" });
		const receipt = scope.node(closingEdge === "receipt-to-guard" ? [] : [guard], null, {
			name: "receipt",
			quiet: true,
		});
		scope.node([guard, receipt], fn, { name: "controller" });
		if (closingEdge === "receipt-to-guard") rewireOwnedNode(authority, [input, receipt], fn);
		let failure: unknown;
		try {
			if (closingEdge === "receipt-to-guard") rewireOwnedNode(receipt, [guard]);
			else rewireOwnedNode(authority, [input, receipt], fn);
		} catch (error) {
			failure = error;
		}
		expect(String(failure)).toContain("would create a cycle");
		expect(invocations).toBe(0);
		expect(() => scope.abort(failure)).toThrow(ColdConstructionError);
		expect(graph.inspect()).toEqual(baseline);
	});
}

it("delivers a bounded receipt frame through a quiet node in an acyclic cold graph", () => {
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
	// graphrefly-ts:D172: the quiet receipt sends its frame after the result's wave, so the
	// controller sees the result and then, in a later wave of its own, the receipt.
	const receipt = scope.node(
		[result],
		(ctx) => {
			for (const frame of depBatch(ctx, 0) ?? []) ctx.down([["DATA", frame]]);
		},
		{ name: "receipt", quiet: true },
	);
	const received: unknown[] = [];
	const controller = scope.node(
		[result, receipt],
		(ctx) => {
			for (const frame of depBatch(ctx, 1) ?? []) received.push(frame);
		},
		{ name: "controller" },
	);
	const owner = scope.seal(startup, [controller]);
	scope.transferToGraph(owner);
	try {
		startConstruction(graph, owner);
		expect(owner.phase).toBe("started");
		expect(received).toEqual([]);
		graph.batch(() => {
			input.set(1);
			input.set(2);
		});
		expect(received).toEqual([[1, 2]]);
	} finally {
		for (const root of owner.roots) root.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const node of owner.nodes) group.add(node);
		group.release();
	}
});

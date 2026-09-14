/** Minimal host-boundary counterexample; no production effect or I/O. */
import { expect, it } from "vitest";
import { batch } from "../batch/batch.js";
import { depBatch } from "../ctx/types.js";
import { Graph } from "../graph/graph.js";

it("an outer batch can produce completion after the wrapped source call has returned", () => {
	const graph = new Graph();
	const source = graph.node<number>([], null, { name: "input" });
	const pending: number[] = [];
	const delivered: number[] = [];
	const trace: string[] = [];
	const guard = graph.node(
		[source],
		(ctx) => {
			for (const value of depBatch(ctx, 0) ?? []) {
				trace.push(`guard:${value}`);
				pending.push(value as number);
			}
		},
		{ name: "fake-host-rejection" },
	);
	const stop = guard.subscribe(() => {});
	const ingress = (value: number) => {
		source.down([["DATA", value]]);
		trace.push("wrapped-return");
		delivered.push(...pending.splice(0));
	};
	try {
		ingress(1);
		expect(delivered).toEqual([1]);
		trace.length = 0;
		batch(() => ingress(2));
		expect(trace).toEqual(["wrapped-return", "guard:2"]);
		expect(delivered).toEqual([1]);
		expect(pending).toEqual([2]);
	} finally {
		stop();
		const group = graph.topologyGroup();
		group.add(guard);
		group.add(source);
		group.release();
	}
});

import { describe, expect, it } from "vitest";
import { nodeWritable } from "../adapters/svelte.js";
import { graph } from "../graph/index.js";
import { boundaryManifest } from "../inspection/boundary.js";

describe("D238 framework adapter subpaths", () => {
	it("derives a framework-neutral boundary manifest from describe topology", () => {
		const g = graph({ name: "boundary" });
		const amount = g.state(0, { name: "amount" });
		const taxed = g.derived([amount], (value) => value + 1, { name: "taxed" });
		g.derived([taxed], (value) => value * 2, { name: "total" });

		const manifest = boundaryManifest(g);

		expect(manifest.inputs.map((node) => node.name)).toEqual(["amount"]);
		expect(manifest.outputs.map((node) => node.name)).toEqual(["total"]);
		expect(manifest.inputs[0].role).toBe("input");
		expect(manifest.inputs[0].type).toBe("state");
		expect(manifest.inputs[0].node).toBe(amount);
		expect(manifest.outputs[0].role).toBe("output");
	});

	it("derives mounted subgraph boundary nodes with live handles", () => {
		const parent = graph({ name: "parent" });
		const child = graph({ name: "child" });
		const amount = child.state(1, { name: "amount" });
		child.derived([amount], (value) => value * 2, { name: "total" });
		parent.mount(child, { at: "child" });

		const manifest = boundaryManifest(parent);

		expect(parent.find("child::amount")).toBe(amount);
		expect(manifest.inputs.map((node) => node.name)).toEqual(["child::amount"]);
		expect(manifest.outputs.map((node) => node.name)).toEqual(["child::total"]);
		expect(manifest.inputs[0].node).toBe(amount);
	});

	it("does not write undefined as ordinary DATA through writable helpers", () => {
		const g = graph();
		const count = g.state(1);
		const writable = nodeWritable(count);

		expect(() => {
			(writable.set as (value: undefined) => void)(undefined);
		}).toThrow(/SENTINEL\/no DATA/);

		expect(count.cache).toBe(1);
	});
});

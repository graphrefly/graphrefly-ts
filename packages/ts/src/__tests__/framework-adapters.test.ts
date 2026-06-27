import { describe, expect, expectTypeOf, it } from "vitest";
import { nodeWritable } from "../adapters/svelte.js";
import { graph } from "../graph/index.js";
import { type BoundaryCapabilityRef, boundaryManifest } from "../inspection/boundary.js";

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

	it("exposes only D348 generic capability refs without changing boundary roles", () => {
		const g = graph({ name: "capabilities" });
		const token = g.state("", {
			name: "token",
			meta: {
				boundaryCapabilities: [
					{ id: "github-oauth", kind: "auth", required: true, sourceRefs: ["github"] },
					{ id: "repo-scope", kind: "permission", required: false },
				],
			},
		});
		const total = g.derived([token], (value) => value.length, {
			name: "total",
			meta: {
				boundaryCapabilities: [
					{ id: "repo-config", kind: "config", required: true },
					{ id: "bad-widget", kind: "widget", required: true },
					{ id: "bad-source-refs", kind: "resource", required: true, sourceRefs: [1] },
				],
			},
		});

		const manifest = boundaryManifest(g);

		expect(manifest.inputs.map((node) => node.name)).toEqual(["token"]);
		expect(manifest.outputs.map((node) => node.name)).toEqual(["total"]);
		expect(manifest.inputs[0].node).toBe(token);
		expect(manifest.outputs[0].node).toBe(total);
		expect(manifest.inputs[0].capabilities).toEqual([
			{ id: "github-oauth", kind: "auth", required: true, sourceRefs: ["github"] },
			{ id: "repo-scope", kind: "permission", required: false },
		]);
		expect(manifest.outputs[0].capabilities).toEqual([
			{ id: "repo-config", kind: "config", required: true },
		]);
		expectTypeOf(manifest.inputs[0].capabilities).toEqualTypeOf<
			readonly BoundaryCapabilityRef[] | undefined
		>();
	});

	it("does not surface product capability objects as boundary refs", () => {
		const g = graph({ name: "product-capability" });
		g.state(0, {
			name: "amount",
			meta: {
				boundaryCapabilities: [
					{ id: "ok", kind: "resource", required: true },
					{ id: "oauth-flow", kind: "auth", required: true, provider: "github" },
					{ id: "config-form", kind: "config", required: true, formSchema: { title: "Repo" } },
				],
			},
		});

		const manifest = boundaryManifest(g);

		expect(manifest.inputs[0].capabilities).toEqual([
			{ id: "ok", kind: "resource", required: true },
		]);
		expect(manifest.inputs[0].capabilities).not.toContainEqual(
			expect.objectContaining({ id: "oauth-flow" }),
		);
		expect(manifest.inputs[0].capabilities).not.toContainEqual(
			expect.objectContaining({ id: "config-form" }),
		);
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

/**
 * R3.3.1 — `g.edges(opts?)` derived edge accessor.
 *
 * Edges are derived from each node's construction-time `_deps` array plus the
 * mount hierarchy. No stored edge registry, no `connect`/`disconnect`. The
 * `recursive: true` option walks mounted subgraphs with `::`-qualified paths.
 *
 * Rust port reference: `Graph::edges(recursive: bool)` (Slice F R3.3.1).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R3.3.1 edges parity — $name", (impl) => {
	// These tests need a derived node with named deps, but only verify
	// `edges()` topology output. The transform's body is irrelevant — what
	// matters is that the node is registered with name "c" (or "z") and
	// declares deps on `a`/`b` (or `y`/`x`). We use impl.combine(...) +
	// g.add(name, node) to land an N-ary node with named deps that works
	// against both impls.
	test("edges() returns local-only edges by default", async () => {
		const g = new impl.Graph("root");
		const a = await g.state<number>("a", 1);
		const b = await g.state<number>("b", 2);
		const c = await g.add("c", await impl.combine([a, b], (vals) => vals));

		const edges = g.edges();
		const edgeSet = new Set(edges.map((e) => `${e[0]}->${e[1]}`));

		expect(edgeSet.has("a->c")).toBe(true);
		expect(edgeSet.has("b->c")).toBe(true);

		// Also no spurious edges:
		expect(edges).toHaveLength(2);

		void c;
		await g.destroy();
	});

	test("edges({ recursive: true }) walks mounted subgraphs with `::` paths", async () => {
		const g = new impl.Graph("root");
		const x = await g.state<number>("x", 1);
		const child = await g.mount("sub");
		const y = await child.state<number>("y", 2);
		const _z = await child.add("z", await impl.combine([y, x], (vals) => vals));
		void _z;

		const edges = g.edges({ recursive: true });
		const edgeSet = new Set(edges.map((e) => `${e[0]}->${e[1]}`));

		// Local edge from root.x reaching into the subgraph's z node — qualified path.
		expect(edgeSet.has("x->sub::z")).toBe(true);
		expect(edgeSet.has("sub::y->sub::z")).toBe(true);

		await g.destroy();
	});

	test("edges() without recursive omits subgraph internals", async () => {
		const g = new impl.Graph("root");
		const _x = await g.state<number>("x", 1);
		const child = await g.mount("sub");
		const y = await child.state<number>("y", 2);
		const _z = await child.add("z", await impl.map(y, (v: number) => v * 2));
		void _x;
		void _z;

		const edges = g.edges();
		// No edge should reference `sub::*` — edges() is local-only by default.
		for (const [from, to] of edges) {
			expect(from.startsWith("sub::")).toBe(false);
			expect(to.startsWith("sub::")).toBe(false);
		}

		await g.destroy();
	});
});

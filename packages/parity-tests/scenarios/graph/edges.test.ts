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
	test("edges() returns local-only edges by default", () => {
		const g = new impl.Graph("root");
		const a = g.state<number>("a", 1);
		const b = g.state<number>("b", 2);
		const c = g.derived<number>("c", [a, b], (data) => {
			const x = data[0]?.[data[0].length - 1] ?? 0;
			const y = data[1]?.[data[1].length - 1] ?? 0;
			return [(x as number) + (y as number)];
		});

		const edges = g.edges();
		const edgeSet = new Set(edges.map((e) => `${e[0]}->${e[1]}`));

		expect(edgeSet.has("a->c")).toBe(true);
		expect(edgeSet.has("b->c")).toBe(true);

		// Also no spurious edges:
		expect(edges).toHaveLength(2);

		void c;
		g.destroy();
	});

	test("edges({ recursive: true }) walks mounted subgraphs with `::` paths", () => {
		const g = new impl.Graph("root");
		const x = g.state<number>("x", 1);
		const child = g.mount("sub");
		const y = child.state<number>("y", 2);
		const _z = child.derived<number>("z", [y, x], (data) => {
			const yv = data[0]?.[data[0].length - 1] ?? 0;
			const xv = data[1]?.[data[1].length - 1] ?? 0;
			return [(yv as number) + (xv as number)];
		});
		void _z;

		const edges = g.edges({ recursive: true });
		const edgeSet = new Set(edges.map((e) => `${e[0]}->${e[1]}`));

		// Local edge from root.x reaching into the subgraph's z node — qualified path.
		expect(edgeSet.has("x->sub::z")).toBe(true);
		expect(edgeSet.has("sub::y->sub::z")).toBe(true);

		g.destroy();
	});

	test("edges() without recursive omits subgraph internals", () => {
		const g = new impl.Graph("root");
		const _x = g.state<number>("x", 1);
		const child = g.mount("sub");
		const y = child.state<number>("y", 2);
		const _z = child.derived<number>("z", [y], (data) => {
			const yv = data[0]?.[data[0].length - 1] ?? 0;
			return [(yv as number) * 2];
		});
		void _x;
		void _z;

		const edges = g.edges();
		// No edge should reference `sub::*` — edges() is local-only by default.
		for (const [from, to] of edges) {
			expect(from.startsWith("sub::")).toBe(false);
			expect(to.startsWith("sub::")).toBe(false);
		}

		g.destroy();
	});
});

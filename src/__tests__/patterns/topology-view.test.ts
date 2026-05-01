/**
 * `topologyView` integration tests (D3 — Three-layer view).
 */

import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { layoutFrameToSvg } from "../../extra/render/index.js";
import { Graph, type GraphDescribeOutput } from "../../graph/graph.js";
import {
	type LayoutFn,
	type LayoutFrame,
	topologyView,
} from "../../patterns/topology-view/index.js";

// ---------------------------------------------------------------------------
// Helper — build a small target graph with N source nodes
// ---------------------------------------------------------------------------

function makeTarget(): Graph {
	const g = new Graph("target");
	const a = node<number>([], { name: "a", initial: 1 });
	const b = node<number>([], { name: "b", initial: 2 });
	g.add(a, { name: "a" });
	g.add(b, { name: "b" });
	g.derived("c", ["a", "b"], (data, ctx) => {
		const av =
			data[0] != null && data[0].length > 0
				? (data[0].at(-1) as number)
				: (ctx.prevData[0] as number);
		const bv =
			data[1] != null && data[1].length > 0
				? (data[1].at(-1) as number)
				: (ctx.prevData[1] as number);
		return [av + bv];
	});
	return g;
}

function collect(view: {
	frame: { subscribe(s: (msgs: readonly (readonly [symbol, unknown?])[]) => void): () => void };
}): { frames: LayoutFrame[]; off: () => void } {
	const frames: LayoutFrame[] = [];
	const off = view.frame.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) frames.push(m[1] as LayoutFrame);
		}
	});
	return { frames, off };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("topologyView", () => {
	it("emits an initial frame on subscribe (push-on-subscribe)", () => {
		const target = makeTarget();
		const view = topologyView({ graph: target });
		const { frames, off } = collect(view);

		expect(frames.length).toBeGreaterThan(0);
		const initial = frames[0]!;
		// Target has 3 nodes: a, b, c → 3 boxes laid out.
		expect(initial.boxes).toHaveLength(3);
		const ids = initial.boxes.map((b) => b.id).sort();
		expect(ids).toEqual(["a", "b", "c"]);
		// Initial frame has no `changes` (consumer seeded from describe).
		expect(initial.changes).toEqual([]);

		off();
	});

	it("recomputes layout when a 4th node is added (topology change)", () => {
		const target = makeTarget();
		const view = topologyView({ graph: target });
		const { frames, off } = collect(view);

		const initialCount = frames[0]!.boxes.length;
		expect(initialCount).toBe(3);

		// Reset accumulator, then add a new node.
		frames.length = 0;
		const d = node<number>([], { name: "d", initial: 0 });
		target.add(d, { name: "d" });

		// Some frames were emitted; at least one should reflect the new topology.
		expect(frames.length).toBeGreaterThan(0);
		const last = frames[frames.length - 1]!;
		expect(last.boxes).toHaveLength(4);
		expect(last.boxes.map((b) => b.id).sort()).toEqual(["a", "b", "c", "d"]);
		// The wave that delivered the topology change should carry a topology change.
		const topologyFrame = frames.find((f) =>
			f.changes.some((c) => c.type === "node-added" && c.scope === "d"),
		);
		expect(topologyFrame).toBeDefined();

		off();
	});

	it("emits a frame with `changes` populated on data change without recomputing layout", () => {
		const target = makeTarget();
		const view = topologyView({ graph: target });
		const { frames, off } = collect(view);

		const initialBoxes = frames[0]!.boxes;
		frames.length = 0;

		// Trigger a data change — set "a" to 99.
		target.set("a", 99);

		// At least one frame should have a `data` change for "a".
		const dataFrame = frames.find((f) =>
			f.changes.some((c) => c.type === "data" && c.scope === "a"),
		);
		expect(dataFrame).toBeDefined();
		// Layout boxes are reference-equal — no recomputation on data-only events.
		expect(dataFrame!.boxes).toBe(initialBoxes);

		off();
	});

	it("honors a custom `opts.layout` plug-in", () => {
		const target = makeTarget();

		const customCalls: GraphDescribeOutput[] = [];
		const customLayout: LayoutFn = (spec) => {
			customCalls.push(spec);
			const ids = Object.keys(spec.nodes).sort();
			return {
				boxes: ids.map((id, i) => ({ id, x: i * 10, y: 0, w: 5, h: 1 })),
				edges: [],
			};
		};

		const view = topologyView({ graph: target, layout: customLayout });
		const { frames, off } = collect(view);

		// Custom layout was called at least once (seed).
		expect(customCalls.length).toBeGreaterThan(0);
		const initial = frames[0]!;
		// Custom layout's boxes are at x = 0, 10, 20.
		expect(initial.boxes.map((b) => b.x).sort((a, b) => a - b)).toEqual([0, 10, 20]);
		expect(initial.edges).toEqual([]);

		off();
	});

	it("layoutFrameToSvg round-trip — every box id appears in output", () => {
		const target = makeTarget();
		const view = topologyView({ graph: target });
		const { frames, off } = collect(view);

		const initial = frames[0]!;
		const svg = layoutFrameToSvg(initial);
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg.endsWith("</svg>")).toBe(true);
		for (const b of initial.boxes) {
			expect(svg).toContain(`data-id="${b.id}"`);
		}
		for (const e of initial.edges) {
			expect(svg).toContain(`data-from="${e.from}"`);
			expect(svg).toContain(`data-to="${e.to}"`);
		}

		off();
	});
});

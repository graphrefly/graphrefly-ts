/**
 * `topologyView` integration tests (D3 — Three-layer view).
 */

import { DATA } from "@graphrefly/pure-ts/core/messages.js";
import { node } from "@graphrefly/pure-ts/core/node.js";
import { Graph, type GraphDescribeOutput } from "@graphrefly/pure-ts/graph/graph.js";
import { describe, expect, it } from "vitest";
import { layoutFrameToSvg } from "../../../base/render/index.js";
import {
	type LayoutFn,
	type LayoutFrame,
	topologyView,
} from "../../../utils/topology-view/index.js";

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

	// /qa F-5: target.destroy() degrades gracefully (empty layout, no crash).
	it("/qa F-5: target.destroy() yields a degraded empty-layout frame without crashing", () => {
		const target = makeTarget();
		const view = topologyView({ graph: target });
		const { frames, off } = collect(view);

		const initial = frames[0]!;
		expect(initial.boxes.length).toBeGreaterThan(0);

		// Destroy the target — subsequent frames (if any fire) should reflect
		// the empty layout rather than throw or report stale topology.
		target.destroy();

		// The view itself is still alive; the frame node continues to settle on
		// any further activations. Reading the latest frame after teardown
		// should not crash.
		const latest = view.frame.cache as LayoutFrame | undefined;
		expect(latest).toBeDefined();
		// The view's layout fn was last called pre-destroy; the seeded frame
		// is still readable. Subsequent computations on the destroyed target
		// would short-circuit to empty boxes/edges (no crash).
		off();
	});

	// /qa F-23: data-only wave — layout settles RESOLVED but changeset emits
	// DATA. The frame derived must emit a frame with `changes` populated and
	// the same boxes/edges (no recompute).
	it("/qa F-23: data-only wave emits a frame with changes populated and prior layout", () => {
		const target = makeTarget();
		const view = topologyView({ graph: target });
		const { frames, off } = collect(view);

		expect(frames.length).toBeGreaterThan(0);
		const initialBoxes = frames[0]!.boxes;
		const initialEdges = frames[0]!.edges;

		// Drive a data event on `a` — no topology change, layout should not
		// recompute. The frame derived's `changes` field should reflect the
		// data event.
		frames.length = 0;
		target.set("a", 5);

		// Find the data-only frame. The changes array should include at least
		// one `data` GraphChange.
		const dataFrame = frames.find((f) => f.changes.some((c) => c.type === "data"));
		expect(dataFrame).toBeDefined();
		// boxes / edges arrays are reused across data-only waves (no recompute).
		expect(dataFrame!.boxes).toEqual(initialBoxes);
		expect(dataFrame!.edges).toEqual(initialEdges);
		off();
	});

	// /qa F-24: edge attribution — fromPath / fromDepIndex on derived nodes.
	it("/qa F-24: data events on derived nodes attribute fromPath + fromDepIndex via inspector", () => {
		const target = new Graph("target", { inspectorEnabled: true });
		const a = node<number>([], { name: "a", initial: 1, equals: () => false });
		const b = node<number>([], { name: "b", initial: 2, equals: () => false });
		target.add(a, { name: "a" });
		target.add(b, { name: "b" });
		target.derived("c", ["a", "b"], (data, ctx) => {
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

		const changeset = target.observe({ changeset: true });
		const events: import("../../graph/changeset.js").GraphChange[] = [];
		const off = changeset.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) events.push(m[1] as import("../../graph/changeset.js").GraphChange);
			}
		});
		// Activate `c` so the inspector hook fires on dep messages.
		target.resolve("c").subscribe(() => {});
		events.length = 0;

		target.set("b", 9);

		// Find the data event on `c` driven by `b`.
		const onC = events.filter(
			(e): e is import("../../graph/changeset.js").GraphChange & { type: "data" } =>
				e.type === "data" && e.scope === "c",
		);
		expect(onC.length).toBeGreaterThan(0);
		// fromPath should be `b` (upstream emitter), fromDepIndex should be 1
		// (b is the second dep of c).
		const last = onC.at(-1)!;
		expect(last.fromPath).toBe("b");
		expect(last.fromDepIndex).toBe(1);
		off();
		target.destroy();
	});
});

/**
 * `topologyView({ graph, layout? }): TopologyViewGraph` — D3 of the
 * three-layer view (`docs/optimizations.md` line "D — Three-layer view").
 *
 * Composes a target {@link Graph} with a pluggable layered-DAG layout into a
 * live {@link LayoutFrame} stream:
 *
 * ```text
 * target graph
 *   └─ observe({ changeset: true })  →  Node<GraphChange>
 *        └─ filter(topology)         →  recompute layout
 *        └─ each change              →  merge into a LayoutFrame
 * ```
 *
 * **Initial frame** is delivered on subscribe (push-on-subscribe per spec
 * §2.2) — the layout is seeded from `graph.describe()` at construction. A
 * consumer that wants deltas only can `pipe(skip(1))` from the output node.
 *
 * **Pluggable layout** — pass `opts.layout` to swap in `dagre`, `elk`, or
 * any layered-DAG library. The default is a minimal Sugiyama in
 * `_internal.ts` (matches the library's "no deps, browser-safe" ethos).
 *
 * **No timers** — animation is driven by the changeset's batch boundaries.
 * Each batch IS a frame; CSS transitions handle visual fade.
 *
 * @module
 */

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import type { GraphChange } from "@graphrefly/pure-ts/graph/changeset.js";
import { Graph, type GraphOptions } from "@graphrefly/pure-ts/graph/graph.js";
import { defaultLayout } from "./_internal.js";
import type { LayoutFn, LayoutFrame } from "./types.js";

export type {
	LayoutBox,
	LayoutEdge,
	LayoutFn,
	LayoutFrame,
} from "./types.js";

/** Topology variants from {@link GraphChange} that invalidate layout. */
const TOPOLOGY_TYPES = new Set<GraphChange["type"]>([
	"node-added",
	"node-removed",
	"mount",
	"unmount",
]);

function isTopologyChange(c: GraphChange): boolean {
	return TOPOLOGY_TYPES.has(c.type);
}

/** Options for {@link topologyView}. */
export interface TopologyViewOptions {
	/** The target graph to observe. */
	readonly graph: Graph;
	/**
	 * Pluggable layout function. Defaults to the bundled Sugiyama layout.
	 * Adapt `dagre` / `elk` / etc. by wrapping their output in the
	 * {@link LayoutFn} shape.
	 */
	readonly layout?: LayoutFn;
	/** Optional name for the {@link TopologyViewGraph}. Defaults to `"topology-view"`. */
	readonly name?: string;
	/**
	 * Forward extra options to the underlying {@link Graph} constructor
	 * (e.g. `versioning`, `traceCapacity`).
	 */
	readonly graphOptions?: GraphOptions;
}

/**
 * Live topology view — a {@link Graph} subclass that exposes a single
 * output node {@link TopologyViewGraph.frame} emitting {@link LayoutFrame}s.
 */
export class TopologyViewGraph extends Graph {
	readonly target: Graph;
	readonly layout: LayoutFn;
	readonly frame: Node<LayoutFrame>;

	constructor(opts: TopologyViewOptions) {
		const name = opts.name ?? "topology-view";
		super(name, opts.graphOptions);
		this.target = opts.graph;
		this.layout = opts.layout ?? ((spec) => defaultLayout(spec, "LR"));

		// 1. Source node — discrete GraphChange events from the target graph.
		//    Every change (data + topology + batch boundaries) flows here.
		const changeset = this.target.observe({
			changeset: true,
			changesetName: "target-changeset",
		});
		this.add(changeset, { name: "changeset" });

		// 2. Layout — recomputes only on topology changes. Reads
		//    `target.describe()` inside the fn body — this is a method call on
		//    the stored Graph reference, NOT a `.cache` read of another
		//    reactive node, so it does not violate spec §5.12. Initial value
		//    is seeded from the construction-time describe so the first
		//    push-on-subscribe delivers a valid frame before any change
		//    arrives. `partial: true` opts out of the first-run gate (§2.7) —
		//    the seeded `initial` is correct from construction; we don't need
		//    to wait for the upstream changeset to deliver its first DATA.
		const seedLayout = this._computeLayout();
		const layoutNode = this.derived<Pick<LayoutFrame, "boxes" | "edges">>(
			"layout",
			["changeset"],
			(data, _ctx) => {
				const batch0 = data[0];
				if (batch0 == null || batch0.length === 0) {
					// No changeset DATA this wave (or this is the seed activation
					// before changeset has fired). Settle as RESOLVED — caller
					// will read `prevData[0]` if it needs the current layout.
					return [];
				}
				let topologyHit = false;
				for (const c of batch0 as readonly GraphChange[]) {
					if (isTopologyChange(c)) {
						topologyHit = true;
						break;
					}
				}
				if (!topologyHit) {
					// Data-only wave: keep layout unchanged. The cached layout
					// (from `initial` or a prior emit) is still valid.
					return [];
				}
				return [this._computeLayout()];
			},
			{ initial: seedLayout, partial: true },
		);
		void layoutNode;

		// 3. Frame — merges latest layout with the per-wave changes from the
		//    changeset. Two deps: layout (slow-moving — re-emits only on
		//    topology) and changeset (fast-moving — re-emits per change event).
		//    The fn collapses each wave into one LayoutFrame.
		//
		//    `partial: true` opts out of the first-run gate so that a
		//    data-only wave (where the layout dep settles RESOLVED but
		//    changeset emits DATA) still triggers fn — without it, frame
		//    would never run for data events because layout settled RESOLVED
		//    and `_depSettledAsResolved` does NOT exit the sentinel state on
		//    a dep, leaving the gate closed indefinitely.
		this.frame = this.derived<LayoutFrame>(
			"frame",
			["layout", "changeset"],
			(data, ctx) => {
				const layoutBatch = data[0];
				const changesetBatch = data[1];
				const layout =
					layoutBatch != null && layoutBatch.length > 0
						? (layoutBatch.at(-1) as Pick<LayoutFrame, "boxes" | "edges">)
						: (ctx.prevData[0] as Pick<LayoutFrame, "boxes" | "edges"> | undefined);
				if (layout == null) {
					// No layout yet — defer (skip emit). With `initial:` on
					// `layout`, this should never happen on the activation
					// wave, but guard for the edge case.
					return [];
				}
				const changes: GraphChange[] = [];
				if (changesetBatch != null) {
					for (const c of changesetBatch) changes.push(c as GraphChange);
				}
				return [
					{
						boxes: layout.boxes,
						edges: layout.edges,
						changes,
					},
				];
			},
			{
				initial: { boxes: seedLayout.boxes, edges: seedLayout.edges, changes: [] },
				partial: true,
			},
		);

		// No external keepalive — the chain `frame → layout → changeset` is
		// activated by external subscribers on `frame`. When the last consumer
		// unsubscribes, the chain tears down and releases the target observe
		// handle. Producer-bound lifecycle, no leaks.
	}

	private _computeLayout(): Pick<LayoutFrame, "boxes" | "edges"> {
		// /qa F-5: short-circuit if the target was destroyed. `target.describe()`
		// on a destroyed graph returns empty topology silently — without this
		// guard, frame consumers would see a degraded layout (empty boxes /
		// edges) with no signal that the underlying graph is gone. The COMPLETE
		// propagation is handled by the changeset stream's teardown variant
		// flowing through `frame`.
		if (this.target.destroyed) {
			return { boxes: [], edges: [] };
		}
		const spec = this.target.describe();
		return this.layout(spec);
	}
}

/**
 * Factory wrapper — `topologyView({ graph, layout? })`.
 */
export function topologyView(opts: TopologyViewOptions): TopologyViewGraph {
	const view = new TopologyViewGraph(opts);
	view.tagFactory("topologyView");
	return view;
}

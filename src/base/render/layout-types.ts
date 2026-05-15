/**
 * Canonical home for layout types. Lives in `extra/render/` because the SVG
 * renderer (`layout-frame-to-svg.ts`) consumes them; `patterns/topology-view`
 * re-exports them through its public types module. Keeping the layering
 * downward (extra/ → patterns/) avoids the inverted import that flagged in
 * /qa F-17.
 *
 * @module
 */

import type { GraphChange } from "@graphrefly/pure-ts/graph/changeset.js";
import type { GraphDescribeOutput } from "@graphrefly/pure-ts/graph/graph.js";

/**
 * One node placement in cell-grid coordinates.
 *
 * `id` is the node's qualified path (`::`-delimited). `x`/`y`/`w`/`h` are
 * direction-agnostic integer cell coordinates produced by the layout; the
 * default direction is `"LR"` (layers grow along x). Renderers map cells →
 * pixels (or characters) at draw time.
 *
 * `meta` is forwarded from the source describe snapshot (read-only) — useful
 * for renderers that color/style by `kind`, factory tag, or domain meta.
 */
export interface LayoutBox {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly meta?: Record<string, unknown>;
}

/**
 * One edge placement. `from`/`to` are qualified node paths. `depIndex` is
 * the positional dep index on the `to` node (matches `fromDepIndex` on
 * {@link GraphChange} `data` events). `points` is the polyline of waypoints
 * (start → corners → end) in cell-grid coordinates.
 */
export interface LayoutEdge {
	readonly from: string;
	readonly to: string;
	readonly depIndex: number;
	readonly points: ReadonlyArray<readonly [number, number]>;
}

/**
 * One frame of the live topology view.
 *
 * - `boxes` — current node placements (full set, not a delta).
 * - `edges` — current edge polylines (full set).
 * - `changes` — the {@link GraphChange} events that flowed in the wave that
 *   produced this frame. Empty on the initial push-on-subscribe frame
 *   (consumers seeded from `graph.describe()`); populated on subsequent
 *   batches. Renderers can highlight changed nodes / animate flowing edges
 *   per change-event scope.
 */
export interface LayoutFrame {
	readonly boxes: readonly LayoutBox[];
	readonly edges: readonly LayoutEdge[];
	readonly changes: readonly GraphChange[];
}

/**
 * Pluggable layout function — receives a {@link GraphDescribeOutput} snapshot
 * and returns the box / edge placements for the current topology. Pure-fn
 * shape so the default in `_internal.ts` and third-party adapters
 * (e.g. wrapping `dagre`, `elk`, `cytoscape`) share the same signature.
 *
 * `changes` (the per-frame batch) is overlaid on the layout's output by
 * `topologyView`'s internal `frame` derived — layout fns don't need to
 * handle batched events themselves.
 */
export type LayoutFn = (spec: GraphDescribeOutput) => Pick<LayoutFrame, "boxes" | "edges">;

/**
 * Default layout for `topologyView` — wraps the bundled Sugiyama-style layered
 * DAG layout from `extra/render/_layout-sugiyama.ts`.
 *
 * The library ships zero deps and is browser-safe by default; the bundled
 * layout matches that ethos. Users wanting production-quality layout can swap
 * in `dagre`, `elk`, etc. by passing `opts.layout` to {@link topologyView}.
 *
 * Direction-agnostic (defaults to `"LR"`). Per-node label sizing is
 * conservative: 1 cell tall, label-length-derived width capped at 24 cells.
 *
 * @module
 */

import {
	type LayoutDirection,
	type LayoutEdgePoint,
	sugiyamaLayout,
} from "../../extra/render/_layout-sugiyama.js";
import type { GraphDescribeOutput } from "../../graph/graph.js";
import type { LayoutFn, LayoutFrame } from "./types.js";

const MIN_W = 3;
const MAX_W = 24;
const NODE_H = 1;
const LAYER_GAP = 4;
const NODE_GAP = 1;

/**
 * Best-effort label-width estimate (cells). Caller can override by providing
 * its own {@link LayoutFn}; this default treats every visible character as
 * one cell. Local-segment is preferred over qualified path so the label
 * stays compact on cells with deep mounts.
 */
function widthOf(id: string): number {
	const local = id.includes("::") ? (id.split("::").pop() ?? id) : id;
	return Math.max(MIN_W, Math.min(MAX_W, local.length + 2));
}

function heightOf(_id: string): number {
	return NODE_H;
}

/**
 * Default layered-DAG layout for `topologyView`. Pure fn over a describe
 * snapshot; deterministic for a given input ordering.
 */
export function defaultLayout(
	spec: GraphDescribeOutput,
	direction: LayoutDirection = "LR",
): Pick<LayoutFrame, "boxes" | "edges"> {
	const ids = Object.keys(spec.nodes).sort();
	const edges = spec.edges.map((e) => ({ from: e.from, to: e.to }));
	if (ids.length === 0) {
		return { boxes: [], edges: [] };
	}
	const result = sugiyamaLayout({
		nodes: ids,
		edges,
		widthCells: widthOf,
		heightCells: heightOf,
		layerGap: LAYER_GAP,
		nodeGap: NODE_GAP,
		direction,
	});

	// Map back to the public LayoutFrame shape, attaching per-node meta from
	// the describe snapshot for downstream renderers (kind/factory/domain).
	const boxes = result.boxes.map((b) => ({
		id: b.id,
		x: b.x,
		y: b.y,
		w: b.w,
		h: b.h,
		meta: spec.nodes[b.id]?.meta,
	}));

	// Build a quick "to → ordered deps" lookup for `depIndex` attribution. The
	// describe snapshot's `nodes[id].deps` is the positional dep array; the
	// edge's depIndex is the position of `from` in `to`'s deps.
	//
	// /qa F-22: when the same upstream appears multiple times in `to.deps`
	// (diamond / duplicate-dep patterns), each (from, to) edge gets a distinct
	// depIndex via a per-`to` running cursor over occurrences in `toDeps`.
	const seenPerTo = new Map<string, number>();
	const edgeOut = result.edges.map((e) => {
		const toDeps = spec.nodes[e.to]?.deps ?? [];
		const cursorKey = `${e.to}::${e.from}`;
		const startFrom = seenPerTo.get(cursorKey) ?? 0;
		const depIndex = toDeps.indexOf(e.from, startFrom);
		seenPerTo.set(cursorKey, depIndex >= 0 ? depIndex + 1 : startFrom);
		const points = e.points.map((p: LayoutEdgePoint) => [p.x, p.y] as const);
		return {
			from: e.from,
			to: e.to,
			depIndex: depIndex >= 0 ? depIndex : -1,
			points: points as ReadonlyArray<readonly [number, number]>,
		};
	});

	return { boxes, edges: edgeOut };
}

/** Adapter — narrows `defaultLayout` to the {@link LayoutFn} signature. */
export const defaultLayoutFn: LayoutFn = (spec) => defaultLayout(spec, "LR");

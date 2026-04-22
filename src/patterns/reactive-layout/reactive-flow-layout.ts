/**
 * Reactive flow layout — multi-column text flowing around shape obstacles
 * (roadmap §7.1, extends `reactiveLayout`).
 *
 * Unlike `reactiveLayout` (single-column, one `maxWidth`) and
 * `reactiveBlockLayout` (vertical stack of heterogeneous blocks), this engine
 * lays out a single stream of text across **N columns** while wrapping around
 * arbitrary **shape obstacles** (circles, rectangles). Each line's available
 * width can differ from every other line's, enabling magazine-style editorial
 * layouts — and the cursor carries seamlessly from column to column so text
 * never duplicates or gaps at boundaries.
 *
 * ```
 * Graph("reactive-flow-layout")
 * ├── state("text")
 * ├── state("font")
 * ├── state("line-height")
 * ├── state("container")           — { width, height, paddingX, paddingY }
 * ├── state("columns")             — { count, gap }
 * ├── state("obstacles")           — Obstacle[] (moves reactively — rAF-friendly)
 * ├── derived("segments")          — text + font → PreparedSegment[]  (from reactiveLayout)
 * ├── derived("flow-lines")        — segments + container + columns + obstacles + line-height
 * │                                  → PositionedLine[]
 * └── meta: { line-count, layout-time-ns, overflow-segments }
 * ```
 *
 * Obstacle positions change every frame; `flow-lines` re-runs per change, but
 * `segments` stays cached (text hasn't changed). Callers drive obstacles via a
 * reactive source like `fromRaf()` piped into a state node.
 */
import { monotonicNs } from "../../core/clock.js";
import type { Node } from "../../core/node.js";
import { node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";
import { emitToMeta } from "../_internal.js";
import {
	analyzeAndMeasure,
	carveTextLineSlots,
	type Interval,
	type LayoutCursor,
	layoutNextLine,
	type MeasurementAdapter,
	type PreparedSegment,
} from "./reactive-layout.js";

// ---------------------------------------------------------------------------
// Obstacle types
// ---------------------------------------------------------------------------

/** A circle obstacle. Center `(cx, cy)`, radius `r`; text keeps `padding` distance. */
export type CircleObstacle = {
	kind: "circle";
	cx: number;
	cy: number;
	r: number;
	/** Horizontal padding between obstacle and wrapped text (default 0). */
	hPad?: number;
	/** Vertical padding — band overlap tolerance (default 0). */
	vPad?: number;
};

/** A rectangle obstacle. Top-left `(x, y)`, size `(w, h)`. */
export type RectObstacle = {
	kind: "rect";
	x: number;
	y: number;
	w: number;
	h: number;
	hPad?: number;
	vPad?: number;
};

/** Union of built-in obstacle shapes. */
export type Obstacle = CircleObstacle | RectObstacle;

/**
 * Compute the horizontal interval occluded by a circle at vertical band
 * `[bandTop, bandBottom]`, or `null` if no occlusion.
 *
 * Exported so consumers that render obstacle outlines in sync with the flow
 * can reuse the same geometry the flow engine uses — no divergence.
 */
export function circleIntervalForBand(
	o: CircleObstacle,
	bandTop: number,
	bandBottom: number,
): Interval | null {
	const hPad = o.hPad ?? 0;
	const vPad = o.vPad ?? 0;
	const top = bandTop - vPad;
	const bottom = bandBottom + vPad;
	if (top >= o.cy + o.r || bottom <= o.cy - o.r) return null;
	const minDy = o.cy >= top && o.cy <= bottom ? 0 : o.cy < top ? top - o.cy : o.cy - bottom;
	if (minDy >= o.r) return null;
	const maxDx = Math.sqrt(o.r * o.r - minDy * minDy);
	return { left: o.cx - maxDx - hPad, right: o.cx + maxDx + hPad };
}

/** Same as `circleIntervalForBand` for rectangles. */
export function rectIntervalForBand(
	o: RectObstacle,
	bandTop: number,
	bandBottom: number,
): Interval | null {
	const hPad = o.hPad ?? 0;
	const vPad = o.vPad ?? 0;
	if (bandBottom <= o.y - vPad) return null;
	if (bandTop >= o.y + o.h + vPad) return null;
	return { left: o.x - hPad, right: o.x + o.w + hPad };
}

function obstacleIntervalForBand(
	o: Obstacle,
	bandTop: number,
	bandBottom: number,
): Interval | null {
	return o.kind === "circle"
		? circleIntervalForBand(o, bandTop, bandBottom)
		: rectIntervalForBand(o, bandTop, bandBottom);
}

// ---------------------------------------------------------------------------
// Flow layout types
// ---------------------------------------------------------------------------

export type FlowContainer = {
	width: number;
	height: number;
	paddingX?: number;
	paddingY?: number;
};

export type FlowColumns = {
	count: number;
	gap: number;
};

/** A single positioned line after flow layout. */
export type PositionedLine = {
	x: number;
	y: number;
	/** Natural measured width of the text content. */
	width: number;
	/** Width of the slot this line was placed in — use this as the DOM element's
	 *  `width` when applying `text-align: justify` so the line stretches to the
	 *  obstacle edge on both sides. */
	slotWidth: number;
	text: string;
	/** Which column index this line belongs to (0-based). */
	columnIndex: number;
	/** `true` iff the slot's right edge was carved short by an obstacle (the
	 *  slot sits to the LEFT of an obstacle). Renderers can right-align text
	 *  in these slots so single-word lines still hug the obstacle — CSS
	 *  `text-align: justify` can't stretch single-word lines, which otherwise
	 *  produces a visible asymmetry vs. the slot on the other side of the
	 *  obstacle (which is flush by default). */
	flushToRight: boolean;
};

/** Options for `reactiveFlowLayout`. */
export type ReactiveFlowLayoutOptions = {
	adapter: MeasurementAdapter;
	name?: string;
	text?: string;
	font?: string;
	lineHeight?: number;
	container?: FlowContainer;
	columns?: FlowColumns;
	obstacles?: Obstacle[];
	/** Minimum slot width (px) below which a slot is discarded rather than squeezed. Default `20`. */
	minSlotWidth?: number;
};

/** Result bundle from `reactiveFlowLayout`. */
export type ReactiveFlowLayoutBundle = {
	graph: Graph;
	setText: (text: string) => void;
	setFont: (font: string) => void;
	setLineHeight: (lh: number) => void;
	setContainer: (c: FlowContainer) => void;
	setColumns: (c: FlowColumns) => void;
	setObstacles: (o: Obstacle[]) => void;
	segments: Node<PreparedSegment[]>;
	flowLines: Node<PositionedLine[]>;
};

// ---------------------------------------------------------------------------
// Pure flow-layout compute
// ---------------------------------------------------------------------------

/** Result of `computeFlowLines`. */
export type FlowLinesResult = {
	/** Positioned lines in render order (columns inner-ordered top-to-bottom). */
	lines: PositionedLine[];
	/** Cursor position after the last line was placed. If
	 *  `cursor.segmentIndex < segments.length`, the layout **truncated** — the
	 *  container couldn't fit all text. */
	cursor: LayoutCursor;
};

/**
 * Lay out `segments` across N columns, wrapping each line around `obstacles`.
 * Pure function — no reactive wiring. Exported for testing and for consumers
 * who want to run flow layout outside a Graph.
 *
 * `carveTextLineSlots` guarantees left-to-right-ordered, non-overlapping slots,
 * so this function does not sort them.
 */
export function computeFlowLines(
	segments: PreparedSegment[],
	container: FlowContainer,
	columns: FlowColumns,
	obstacles: Obstacle[],
	lineHeight: number,
	minSlotWidth: number,
): FlowLinesResult {
	const lines: PositionedLine[] = [];
	let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
	if (segments.length === 0 || columns.count <= 0 || lineHeight <= 0) {
		return { lines, cursor };
	}

	const padX = container.paddingX ?? 0;
	const padY = container.paddingY ?? 0;
	const availWidth = Math.max(0, container.width - padX * 2);
	const availHeight = Math.max(0, container.height - padY * 2);
	const gapTotal = columns.gap * Math.max(0, columns.count - 1);
	const colWidth = Math.max(0, (availWidth - gapTotal) / columns.count);
	if (colWidth <= 0) return { lines, cursor };

	outerCol: for (let col = 0; col < columns.count; col++) {
		const colLeft = padX + col * (colWidth + columns.gap);
		const colRight = colLeft + colWidth;
		let bandTop = padY;

		while (bandTop + lineHeight <= padY + availHeight) {
			const bandBottom = bandTop + lineHeight;
			const blocked: Interval[] = [];
			for (let oi = 0; oi < obstacles.length; oi++) {
				const iv = obstacleIntervalForBand(obstacles[oi]!, bandTop, bandBottom);
				if (iv !== null) blocked.push(iv);
			}
			const slots = carveTextLineSlots({ left: colLeft, right: colRight }, blocked, minSlotWidth);

			if (slots.length === 0) {
				bandTop += lineHeight;
				continue;
			}

			let hardBreakThisBand = false;
			for (let si = 0; si < slots.length; si++) {
				const slot = slots[si]!;
				const slotW = slot.right - slot.left;
				const line = layoutNextLine(segments, cursor, slotW);
				if (line === null) {
					return { lines, cursor };
				}
				if (line.text.length === 0 && line.width === 0) {
					// Hard-break — advance cursor past the break segment and end
					// THIS band so the break produces a visible paragraph gap
					// rather than being silently absorbed across remaining slots.
					cursor = line.end;
					hardBreakThisBand = true;
					break;
				}
				lines.push({
					x: slot.left,
					y: bandTop,
					width: line.width,
					slotWidth: slotW,
					text: line.text,
					columnIndex: col,
					flushToRight: slot.right < colRight - 0.5,
				});
				cursor = line.end;
			}

			bandTop += lineHeight;
			if (hardBreakThisBand) continue;
			if (cursor.segmentIndex >= segments.length) break outerCol;
		}

		if (cursor.segmentIndex >= segments.length) break;
	}

	return { lines, cursor };
}

// ---------------------------------------------------------------------------
// Reactive graph factory
// ---------------------------------------------------------------------------

/**
 * Create a reactive flow-layout graph: N columns of text wrapping around
 * shape obstacles. Re-runs only the dependent derived nodes on any input
 * change. Obstacle movement (e.g. rAF-driven) invalidates `flow-lines` only;
 * `segments` stays cached as long as `text`/`font` don't change.
 *
 * @example
 * ```ts
 * import { fromRaf, reactiveFlowLayout } from "@graphrefly/graphrefly-ts";
 *
 * const flow = reactiveFlowLayout({
 *   adapter: new CanvasMeasureAdapter(),
 *   text: longEssay,
 *   font: "18px serif",
 *   lineHeight: 26,
 *   container: { width: 900, height: 600, paddingX: 40, paddingY: 40 },
 *   columns: { count: 2, gap: 32 },
 *   obstacles: [{ kind: "circle", cx: 450, cy: 300, r: 80 }],
 * });
 *
 * // Animate the obstacle via rAF:
 * fromRaf().subscribe(([[, t]]) => {
 *   const x = 450 + 120 * Math.sin((t as number) * 0.001);
 *   flow.setObstacles([{ kind: "circle", cx: x, cy: 300, r: 80 }]);
 * });
 * ```
 */
export function reactiveFlowLayout(opts: ReactiveFlowLayoutOptions): ReactiveFlowLayoutBundle {
	const { adapter, name = "reactive-flow-layout", minSlotWidth = 20 } = opts;
	const g = new Graph(name);

	const measureCache = new Map<string, Map<string, number>>();

	const textNode = state<string>(opts.text ?? "", { name: "text" });
	const fontNode = state<string>(opts.font ?? "16px sans-serif", { name: "font" });
	const lineHeightNode = state<number>(opts.lineHeight ?? 20, { name: "line-height" });
	const containerNode = state<FlowContainer>(
		opts.container ?? { width: 800, height: 600, paddingX: 0, paddingY: 0 },
		{ name: "container" },
	);
	const columnsNode = state<FlowColumns>(opts.columns ?? { count: 1, gap: 0 }, {
		name: "columns",
	});
	const obstaclesNode = state<Obstacle[]>(opts.obstacles ?? [], { name: "obstacles" });

	const segmentsNode: Node<PreparedSegment[]> = node<PreparedSegment[]>(
		[textNode, fontNode],
		(data, actions, ctx) => {
			const b0 = data[0];
			const textVal = (b0 != null && b0.length > 0 ? b0.at(-1) : ctx.prevData[0]) as string;
			const b1 = data[1];
			const fontVal = (b1 != null && b1.length > 0 ? b1.at(-1) : ctx.prevData[1]) as string;
			const result = analyzeAndMeasure(textVal, fontVal, adapter, measureCache);
			actions.emit(result);
			// Flush on deactivation + INVALIDATE only — preserve cache across
			// fn re-runs so text/font edits don't wipe per-segment entries that
			// still match the new text.
			const flush = (): void => {
				measureCache.clear();
				adapter.clearCache?.();
			};
			return { deactivate: flush, invalidate: flush };
		},
		{ name: "segments", describeKind: "derived" },
	);

	const flowLinesNode = derived<PositionedLine[]>(
		[segmentsNode, containerNode, columnsNode, obstaclesNode, lineHeightNode],
		([segs, cont, cols, obs, lh]) => {
			const segments = segs as PreparedSegment[];
			const t0 = monotonicNs();
			const { lines: result, cursor } = computeFlowLines(
				segments,
				cont as FlowContainer,
				cols as FlowColumns,
				obs as Obstacle[],
				lh as number,
				minSlotWidth,
			);
			const elapsed = monotonicNs() - t0;
			// Overflow signal: segments left unlaid-out after the container is
			// exhausted. `0` means all text fit; `N > 0` means the container
			// occluded/overflowed N segments — consumers can surface a "…more"
			// indicator, grow the container, or discard obstacles.
			const overflow = Math.max(0, segments.length - cursor.segmentIndex);
			const meta = flowLinesNode.meta;
			if (meta) {
				emitToMeta(meta["line-count"], result.length);
				emitToMeta(meta["layout-time-ns"], elapsed);
				emitToMeta(meta["overflow-segments"], overflow);
			}
			return result;
		},
		{
			name: "flow-lines",
			meta: {
				"line-count": 0,
				"layout-time-ns": 0,
				"overflow-segments": 0,
			},
			equals: (a, b) => {
				const la = a as PositionedLine[];
				const lb = b as PositionedLine[];
				if (la.length !== lb.length) return false;
				for (let i = 0; i < la.length; i++) {
					const pa = la[i]!;
					const pb = lb[i]!;
					if (
						pa.x !== pb.x ||
						pa.y !== pb.y ||
						pa.width !== pb.width ||
						pa.slotWidth !== pb.slotWidth ||
						pa.text !== pb.text ||
						pa.columnIndex !== pb.columnIndex ||
						pa.flushToRight !== pb.flushToRight
					)
						return false;
				}
				return true;
			},
		},
	);

	g.add(textNode, { name: "text" });
	g.add(fontNode, { name: "font" });
	g.add(lineHeightNode, { name: "line-height" });
	g.add(containerNode, { name: "container" });
	g.add(columnsNode, { name: "columns" });
	g.add(obstaclesNode, { name: "obstacles" });
	g.add(segmentsNode, { name: "segments" });
	g.add(flowLinesNode, { name: "flow-lines" });

	return {
		graph: g,
		setText: (t: string) => g.set("text", t),
		setFont: (f: string) => g.set("font", f),
		setLineHeight: (lh: number) => g.set("line-height", lh),
		setContainer: (c: FlowContainer) => g.set("container", c),
		setColumns: (c: FlowColumns) => g.set("columns", c),
		setObstacles: (o: Obstacle[]) => g.set("obstacles", o),
		segments: segmentsNode,
		flowLines: flowLinesNode,
	};
}

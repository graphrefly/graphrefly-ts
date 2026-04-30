/**
 * Reactive multi-content block layout engine (roadmap §7.1 — mixed content).
 *
 * Extends the text-only `reactiveLayout` with support for image and SVG blocks.
 * Pure-arithmetic layout over measured child sizes — no DOM, no async.
 *
 * Graph shape:
 * ```
 * Graph("reactive-block-layout")
 * ├── node([], { initial: "blocks" })              — ContentBlock[] input
 * ├── node([], { initial: "max-width" })           — container constraint
 * ├── node([], { initial: "gap" })                 — vertical gap between blocks (px)
 * ├── derived("measured-blocks")   — blocks → MeasuredBlock[] (per-type measurement)
 * ├── derived("block-flow")        — measured-blocks + max-width + gap → PositionedBlock[]
 * ├── derived("total-height")      — block-flow → total height
 * └── meta: { block-count, layout-time-ns }
 * ```
 */
import { monotonicNs } from "../../core/clock.js";
import { type Node, node } from "../../core/node.js";

import { Graph } from "../../graph/graph.js";
import { emitToMeta } from "../_internal/index.js";
import {
	analyzeAndMeasure,
	type CharPosition,
	computeCharPositions,
	computeLineBreaks,
	type LineBreaksResult,
	type MeasurementAdapter,
	type PreparedSegment,
} from "./reactive-layout.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pluggable measurement backend for SVG content. */
export interface SvgMeasurer {
	measureSvg(content: string): { width: number; height: number };
}

/** Pluggable measurement backend for image content. */
export interface ImageMeasurer {
	measureImage(src: string): { width: number; height: number };
}

/** Adapters map for `reactiveBlockLayout`. */
export type BlockAdapters = {
	/** Text measurement adapter (required — delegates to `reactiveLayout` internals). */
	text: MeasurementAdapter;
	/** SVG measurement (optional — required only if SVG blocks are present). */
	svg?: SvgMeasurer;
	/** Image measurement (optional — required only if image blocks without explicit dimensions are present). */
	image?: ImageMeasurer;
};

/** A content block — text, image, or SVG. */
export type ContentBlock =
	| {
			type: "text";
			text: string;
			font?: string;
			lineHeight?: number;
	  }
	| {
			type: "image";
			src: string;
			/** Natural width in px. Required if no ImageMeasurer adapter is provided. */
			naturalWidth?: number;
			/** Natural height in px. Required if no ImageMeasurer adapter is provided. */
			naturalHeight?: number;
	  }
	| {
			type: "svg";
			content: string;
			/** Explicit viewBox dimensions. Required if no SvgMeasurer adapter is provided. */
			viewBox?: { width: number; height: number };
	  };

/**
 * A block after measurement — knows its natural dimensions.
 *
 * **Equality note:** The reactive `measured-blocks` node uses dimension-only equality
 * (`type`, `width`, `height`, `index`). Inner text layout data (`textSegments`,
 * `textLineBreaks`, `textCharPositions`) is NOT compared for change detection.
 * If you need text-level reactivity, use `reactiveLayout()` directly per text block.
 */
export type MeasuredBlock = {
	index: number;
	type: "text" | "image" | "svg";
	width: number;
	height: number;
	/** For text blocks: the inner layout results. */
	textSegments?: PreparedSegment[];
	textLineBreaks?: LineBreaksResult;
	textCharPositions?: CharPosition[];
};

/** A block after flow — positioned in the container. */
export type PositionedBlock = MeasuredBlock & {
	x: number;
	y: number;
};

/** Options for `reactiveBlockLayout`. */
export type ReactiveBlockLayoutOptions = {
	adapters: BlockAdapters;
	name?: string;
	blocks?: ContentBlock[];
	/** Container max width in px (clamped to ≥ 0 on init and `setMaxWidth`). */
	maxWidth?: number;
	/** Vertical gap between blocks in px (default 0). */
	gap?: number;
	/** Default font for text blocks that don't specify one. */
	defaultFont?: string;
	/** Default line height for text blocks that don't specify one. */
	defaultLineHeight?: number;
};

/** Result bundle from `reactiveBlockLayout`. */
export type ReactiveBlockLayoutBundle = {
	graph: Graph;
	setBlocks: (blocks: ContentBlock[]) => void;
	setMaxWidth: (maxWidth: number) => void;
	setGap: (gap: number) => void;
	measuredBlocks: Node<MeasuredBlock[]>;
	blockFlow: Node<PositionedBlock[]>;
	totalHeight: Node<number>;
};

// ---------------------------------------------------------------------------
// Block measurement (pure functions)
// ---------------------------------------------------------------------------

/**
 * Measure a single content block, returning natural (unconstrained) dimensions.
 * Text blocks use the text layout pipeline; image/SVG use adapters or explicit dims.
 */
export function measureBlock(
	block: ContentBlock,
	maxWidth: number,
	adapters: BlockAdapters,
	measureCache: Map<string, Map<string, number>>,
	defaultFont: string,
	defaultLineHeight: number,
	index: number,
): MeasuredBlock {
	switch (block.type) {
		case "text": {
			const font = block.font ?? defaultFont;
			const lineHeight = block.lineHeight ?? defaultLineHeight;
			const segments = analyzeAndMeasure(block.text, font, adapters.text, measureCache);
			const lineBreaks = computeLineBreaks(segments, maxWidth, adapters.text, font, measureCache);
			const charPositions = computeCharPositions(lineBreaks, segments, lineHeight);
			const height = lineBreaks.lineCount * lineHeight;
			// Width is the max line width (clamped to maxWidth)
			let width = 0;
			for (const line of lineBreaks.lines) {
				if (line.width > width) width = line.width;
			}
			return {
				index,
				type: "text",
				width: Math.min(width, maxWidth),
				height,
				textSegments: segments,
				textLineBreaks: lineBreaks,
				textCharPositions: charPositions,
			};
		}
		case "image": {
			let w: number;
			let h: number;
			if (block.naturalWidth != null && block.naturalHeight != null) {
				w = block.naturalWidth;
				h = block.naturalHeight;
			} else if (adapters.image) {
				const dims = adapters.image.measureImage(block.src);
				w = dims.width;
				h = dims.height;
			} else {
				throw new Error(
					`Image block at index ${index} has no naturalWidth/naturalHeight and no ImageMeasurer adapter`,
				);
			}
			// Scale proportionally to fit maxWidth
			if (w > maxWidth) {
				h = (h * maxWidth) / w;
				w = maxWidth;
			}
			return { index, type: "image", width: w, height: h };
		}
		case "svg": {
			let w: number;
			let h: number;
			if (block.viewBox) {
				w = block.viewBox.width;
				h = block.viewBox.height;
			} else if (adapters.svg) {
				const dims = adapters.svg.measureSvg(block.content);
				w = dims.width;
				h = dims.height;
			} else {
				throw new Error(`SVG block at index ${index} has no viewBox and no SvgMeasurer adapter`);
			}
			// Scale proportionally to fit maxWidth
			if (w > maxWidth) {
				h = (h * maxWidth) / w;
				w = maxWidth;
			}
			return { index, type: "svg", width: w, height: h };
		}
	}
}

/**
 * Measure all blocks in a content array.
 */
export function measureBlocks(
	blocks: ContentBlock[],
	maxWidth: number,
	adapters: BlockAdapters,
	measureCache: Map<string, Map<string, number>>,
	defaultFont: string,
	defaultLineHeight: number,
): MeasuredBlock[] {
	return blocks.map((block, i) =>
		measureBlock(block, maxWidth, adapters, measureCache, defaultFont, defaultLineHeight, i),
	);
}

// ---------------------------------------------------------------------------
// Block flow (pure function)
// ---------------------------------------------------------------------------

/**
 * Vertical stacking flow: blocks are placed top-to-bottom, left-aligned,
 * separated by `gap` pixels. Pure arithmetic over measured sizes.
 */
export function computeBlockFlow(measured: MeasuredBlock[], gap: number): PositionedBlock[] {
	const result: PositionedBlock[] = [];
	let y = 0;
	for (let i = 0; i < measured.length; i++) {
		const m = measured[i]!;
		result.push({ ...m, x: 0, y });
		y += m.height + (i < measured.length - 1 ? gap : 0);
	}
	return result;
}

/**
 * Compute total height from positioned blocks.
 */
export function computeTotalHeight(flow: PositionedBlock[]): number {
	if (flow.length === 0) return 0;
	const last = flow[flow.length - 1]!;
	return last.y + last.height;
}

// ---------------------------------------------------------------------------
// Reactive graph factory
// ---------------------------------------------------------------------------

/**
 * Create a reactive block layout graph for mixed content (text + image + SVG).
 *
 * ```
 * Graph("reactive-block-layout")
 * ├── node([], { initial: "blocks" })              — ContentBlock[] input
 * ├── node([], { initial: "max-width" })           — container constraint
 * ├── node([], { initial: "gap" })                 — vertical gap (px)
 * ├── derived("measured-blocks")   — blocks + max-width → MeasuredBlock[]
 * ├── derived("block-flow")        — measured-blocks + gap → PositionedBlock[]
 * ├── derived("total-height")      — block-flow → number
 * └── meta: { block-count, layout-time-ns }
 * ```
 */
export function reactiveBlockLayout(opts: ReactiveBlockLayoutOptions): ReactiveBlockLayoutBundle {
	const {
		adapters,
		name = "reactive-block-layout",
		defaultFont = "16px sans-serif",
		defaultLineHeight = 20,
	} = opts;
	const g = new Graph(name);

	// Shared text measurement cache (same structure as reactiveLayout)
	const measureCache = new Map<string, Map<string, number>>();

	// --- State nodes ---
	const blocksNode = node<ContentBlock[]>([], { name: "blocks", initial: opts.blocks ?? [] });
	const maxWidthNode = node<number>([], {
		name: "max-width",
		initial: Math.max(0, opts.maxWidth ?? 800),
	});
	const gapNode = node<number>([], { name: "gap", initial: opts.gap ?? 0 });

	// --- Derived: measured-blocks ---
	// Raw `node(...)` instead of `derived(...)` so the fn can return a
	// cleanup function. Core fires function-form cleanup on INVALIDATE (see
	// `node.ts:_updateState` INVALIDATE branch), which lets us flush the
	// measure cache and the downstream adapter cache reactively — replaces
	// the old v4 per-node `onMessage` hook that watched for INVALIDATE.
	const measuredBlocksNode: Node<MeasuredBlock[]> = node<MeasuredBlock[]>(
		[blocksNode, maxWidthNode],
		(data, actions, ctx) => {
			const blocksVal = data[0] != null && data[0].length > 0 ? data[0].at(-1) : ctx.prevData[0];
			const mwVal = data[1] != null && data[1].length > 0 ? data[1].at(-1) : ctx.prevData[1];
			const t0 = monotonicNs();
			const result = measureBlocks(
				blocksVal as ContentBlock[],
				mwVal as number,
				adapters,
				measureCache,
				defaultFont,
				defaultLineHeight,
			);
			const elapsed = monotonicNs() - t0;

			// Phase-3 meta deferral (parity with reactiveLayout)
			const meta = measuredBlocksNode.meta;
			if (meta) {
				emitToMeta(meta["block-count"], result.length);
				emitToMeta(meta["layout-time-ns"], elapsed);
			}

			actions.emit(result);

			// Object-form cleanup: flush on deactivation + INVALIDATE only,
			// NOT before fn re-runs. Preserves cached measurements across
			// block edits so a single-block change doesn't wipe entries from
			// the other blocks. Image/SVG measurers don't expose a cache hook.
			const flush = (): void => {
				measureCache.clear();
				adapters.text.clearCache?.();
			};
			return { deactivate: flush, invalidate: flush };
		},
		{
			name: "measured-blocks",
			describeKind: "derived",
			meta: { "block-count": 0, "layout-time-ns": 0 },
			equals: (a, b) => {
				const ma = a as MeasuredBlock[] | null;
				const mb = b as MeasuredBlock[] | null;
				if (ma == null || mb == null) return ma === mb;
				if (ma.length !== mb.length) return false;
				for (let i = 0; i < ma.length; i++) {
					const ba = ma[i]!;
					const bb = mb[i]!;
					if (
						ba.type !== bb.type ||
						ba.width !== bb.width ||
						ba.height !== bb.height ||
						ba.index !== bb.index
					)
						return false;
				}
				return true;
			},
		},
	);

	// --- Derived: block-flow ---
	const blockFlowNode = node<PositionedBlock[]>(
		[measuredBlocksNode, gapNode],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(computeBlockFlow(data[0] as MeasuredBlock[], data[1] as number));
		},
		{
			name: "block-flow",
			describeKind: "derived",
			equals: (a, b) => {
				const fa = a as PositionedBlock[] | null;
				const fb = b as PositionedBlock[] | null;
				if (fa == null || fb == null) return fa === fb;
				if (fa.length !== fb.length) return false;
				for (let i = 0; i < fa.length; i++) {
					const pa = fa[i]!;
					const pb = fb[i]!;
					if (pa.x !== pb.x || pa.y !== pb.y || pa.width !== pb.width || pa.height !== pb.height)
						return false;
				}
				return true;
			},
		},
	);

	// --- Derived: total-height ---
	const totalHeightNode = node<number>(
		[blockFlowNode],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(computeTotalHeight(data[0] as PositionedBlock[]));
		},
		{ describeKind: "derived", name: "total-height" },
	);

	// --- Register in graph ---
	g.add(blocksNode, { name: "blocks" });
	g.add(maxWidthNode, { name: "max-width" });
	g.add(gapNode, { name: "gap" });
	g.add(measuredBlocksNode, { name: "measured-blocks" });
	g.add(blockFlowNode, { name: "block-flow" });
	g.add(totalHeightNode, { name: "total-height" });

	// --- Edges (for describe() visibility) ---

	return {
		graph: g,
		setBlocks: (blocks: ContentBlock[]) => g.set("blocks", blocks),
		setMaxWidth: (mw: number) => g.set("max-width", Math.max(0, mw)),
		setGap: (gap: number) => g.set("gap", gap),
		measuredBlocks: measuredBlocksNode,
		blockFlow: blockFlowNode,
		totalHeight: totalHeightNode,
	};
}

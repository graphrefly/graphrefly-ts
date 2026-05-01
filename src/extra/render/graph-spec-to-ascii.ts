/**
 * `graphSpecToAscii(g, opts?)` — stdout-native DAG flowchart renderer for a
 * {@link GraphDescribeOutput}.
 *
 * Zero external dependencies, graph-size independent via proper Sugiyama
 * (layer assignment → virtual-node splitting → barycenter crossing
 * minimization → median-aligned coordinate assignment → per-gutter
 * track-assigned orthogonal routing). See
 * [_layout-sugiyama.ts](./_layout-sugiyama.ts) for the layout pipeline and
 * [_ascii-grid.ts](./_ascii-grid.ts) for the character blitter.
 *
 * Pure function over the describe snapshot; no Graph instance dependency.
 *
 * @category extra
 */

import type { GraphDescribeOutput } from "../../graph/graph.js";
import { renderGrid } from "./_ascii-grid.js";
import { countCells, truncateToCells } from "./_ascii-width.js";
import type { LayoutDirection } from "./_layout-sugiyama.js";
import { sugiyamaLayout } from "./_layout-sugiyama.js";

const DEFAULT_LABEL_WIDTH = 24;
const LAYER_GAP = 4;
const NODE_GAP = 1;
const BOX_HEIGHT = 3;

export type GraphSpecToAsciiOptions = {
	/**
	 * ASCII layout direction. ASCII grid semantics are meaningful only for
	 * `"LR"` (default) and `"TD"`.
	 */
	direction?: LayoutDirection;
	/** Per-box label cell cap; longer labels are truncated with `…`. Default `24`. */
	maxLabelWidth?: number;
	/** Glyph set: `"unicode"` (default, box-drawing) or `"ascii"` (`-|+<>v`). */
	asciiCharset?: "unicode" | "ascii";
	/** Optional logger hook; fires with the rendered text before return. */
	logger?: (text: string) => void;
};

export function graphSpecToAscii(g: GraphDescribeOutput, opts?: GraphSpecToAsciiOptions): string {
	const direction = normalizeAsciiDirection(opts?.direction);
	const maxLabel = Math.max(3, opts?.maxLabelWidth ?? DEFAULT_LABEL_WIDTH);
	const charset = opts?.asciiCharset ?? "unicode";

	// Deterministic paths ordering — match the rest of describe rendering.
	const paths = Object.keys(g.nodes).sort();
	// Drop edges whose endpoints aren't in the current visible path set
	// (respects actor filtering that the caller already applied).
	const nodeSet = new Set(paths);
	const edges = g.edges.filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));

	// Precompute truncated labels + cell widths so the layout knows box
	// dimensions without re-measuring.
	const labels = new Map<string, string>();
	const widths = new Map<string, number>();
	for (const p of paths) {
		const label = truncateToCells(p, maxLabel);
		labels.set(p, label);
		// Box width = label cells + 2 side borders + 2 cells of padding.
		widths.set(p, countCells(label) + 4);
	}

	const layout = sugiyamaLayout({
		nodes: paths,
		edges,
		widthCells: (id) => widths.get(id) ?? 3,
		heightCells: () => BOX_HEIGHT,
		layerGap: LAYER_GAP,
		nodeGap: NODE_GAP,
		direction,
	});

	const text = renderGrid(layout, {
		charset,
		labelOf: (id) => labels.get(id) ?? id,
	});

	opts?.logger?.(text);
	return text;
}

function normalizeAsciiDirection(direction: unknown): LayoutDirection {
	if (direction === undefined || direction === "LR") return "LR";
	if (direction === "TD") return "TD";
	// BT / RL are valid for the vector diagram formats but ASCII grid
	// semantics are meaningful only for LR and TD — reject early with a
	// clear message rather than silently ignoring.
	throw new Error(`ascii describe supports direction "LR" or "TD" only; got ${String(direction)}`);
}

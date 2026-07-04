import { analyzeAndMeasure, computeCharPositions, computeLineBreaks } from "./line.js";
import { tryMeasureHyphenWidth } from "./measurements.js";
import type { ContentBlock, MeasureBlockOptions, MeasuredBlock, PositionedBlock } from "./types.js";
import {
	blockMaxWidth,
	clampDimension,
	fitSize,
	nonNegativeFinite,
	positiveFinite,
	resolveTextAdapter,
} from "./utils.js";

/** Measure one text/image/SVG block using only explicit or injected synchronous adapters.
 * @param block - block value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `MeasuredBlock` value.
 * @category solutions
 * @example
 * ```ts
 * import { measureBlock } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function measureBlock(block: ContentBlock, opts: MeasureBlockOptions): MeasuredBlock {
	const maxWidth = nonNegativeFinite(opts.maxWidth ?? 800, 800);
	const marginTop = nonNegativeFinite(block.marginTop ?? 0, 0);
	const marginBottom = nonNegativeFinite(block.marginBottom ?? 0, 0);
	if (block.kind === "text") {
		const adapter = resolveTextAdapter(opts);
		const font = block.font ?? opts.font ?? "16px sans-serif";
		const lineHeight = positiveFinite(block.lineHeight ?? opts.lineHeight ?? 20, 20);
		const cache = opts.cache ?? new Map<string, Map<string, number>>();
		const width = blockMaxWidth(block.maxWidth, maxWidth);
		const segments = analyzeAndMeasure(
			block.text,
			font,
			adapter,
			cache,
			undefined,
			opts.segmentAdapter,
		);
		const hyphenWidth = Object.hasOwn(opts, "hyphenWidth")
			? opts.hyphenWidth
			: tryMeasureHyphenWidth(adapter, font);
		const lineBreaks = computeLineBreaks(segments, width, {
			hyphenWidth,
			segmentAdapter: opts.segmentAdapter,
		});
		const charPositions = computeCharPositions(
			lineBreaks,
			segments,
			lineHeight,
			opts.segmentAdapter,
		);
		return {
			block,
			kind: block.kind,
			id: block.id,
			width: lineBreaks.lines.reduce((acc, line) => Math.max(acc, line.width), 0),
			height: lineBreaks.lineCount * lineHeight,
			marginTop,
			marginBottom,
			segments,
			lineBreaks,
			charPositions,
		};
	}
	if (block.kind === "image") {
		const explicit =
			block.width !== undefined && block.height !== undefined
				? { width: clampDimension(block.width), height: clampDimension(block.height) }
				: opts.adapters?.image?.measureImage(block.src);
		if (!explicit) throw new Error("Image blocks require width/height or an ImageMeasurer");
		const size = fitSize(explicit, blockMaxWidth(block.maxWidth, maxWidth));
		return {
			block,
			kind: block.kind,
			id: block.id,
			width: size.width,
			height: size.height,
			marginTop,
			marginBottom,
		};
	}
	const explicit =
		block.width !== undefined && block.height !== undefined
			? { width: clampDimension(block.width), height: clampDimension(block.height) }
			: opts.adapters?.svg?.measureSvg(block.svg);
	if (!explicit) throw new Error("SVG blocks require width/height or a SvgMeasurer");
	const size = fitSize(explicit, blockMaxWidth(block.maxWidth, maxWidth));
	return {
		block,
		kind: block.kind,
		id: block.id,
		width: size.width,
		height: size.height,
		marginTop,
		marginBottom,
	};
}

/** Measure a block list while sharing a measurement cache across text blocks.
 * @param blocks - blocks value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `readonly MeasuredBlock[]` value.
 * @category solutions
 * @example
 * ```ts
 * import { measureBlocks } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function measureBlocks(
	blocks: readonly ContentBlock[],
	opts: MeasureBlockOptions,
): readonly MeasuredBlock[] {
	const cache = opts.cache ?? new Map<string, Map<string, number>>();
	return blocks.map((block) => measureBlock(block, { ...opts, cache }));
}

/** Stack measured blocks vertically with margins and a fixed gap.
 * @param blocks - blocks value used by the helper.
 * @param gap - gap value used by the helper.
 * @returns A `readonly PositionedBlock[]` value.
 * @category solutions
 * @example
 * ```ts
 * import { computeBlockFlow } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function computeBlockFlow(
	blocks: readonly MeasuredBlock[],
	gap = 0,
): readonly PositionedBlock[] {
	const spacing = nonNegativeFinite(gap, 0);
	let y = 0;
	return blocks.map((block) => {
		y += block.marginTop;
		const positioned: PositionedBlock = { ...block, x: 0, y };
		y += block.height + block.marginBottom + spacing;
		return positioned;
	});
}

/** Compute the bottom edge of a positioned block flow.
 * @param blocks - blocks value used by the helper.
 * @returns A `number` value.
 * @category solutions
 * @example
 * ```ts
 * import { computeTotalHeight } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function computeTotalHeight(blocks: readonly PositionedBlock[]): number {
	if (blocks.length === 0) return 0;
	let bottom = 0;
	for (const block of blocks) {
		bottom = Math.max(bottom, block.y + block.height + block.marginBottom);
	}
	return bottom;
}

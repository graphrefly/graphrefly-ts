import type { Ctx } from "../../ctx/types.js";
import { moduleName } from "../../graph/module-naming.js";
import { Node } from "../../node/node.js";
import { computeBlockFlow, computeTotalHeight } from "./block.js";
import {
	computeFlowLines,
	sanitizeFlowColumns,
	sanitizeFlowContainer,
	sanitizeObstacles,
} from "./flow.js";
import { computeCharPositions, computeLineBreaks } from "./line.js";
import { inputNode, latestMeasurementValue, scopedName } from "./measurements.js";
import { getDefaultSegmentAdapter } from "./segment.js";
import type {
	BlocksMeasurement,
	CharPosition,
	FlowColumns,
	FlowContainer,
	FlowLinesResult,
	LineBreaksResult,
	MeasuredBlock,
	Measurements,
	Obstacle,
	PositionedBlock,
	PreparedSegment,
	ReactiveBlockLayoutBundle,
	ReactiveBlockLayoutOptions,
	ReactiveFlowLayoutBundle,
	ReactiveFlowLayoutOptions,
	ReactiveLayoutBundle,
	ReactiveLayoutOptions,
	TextSegmentsMeasurement,
} from "./types.js";
import { BLOCKS_MEASUREMENT_KIND, TEXT_SEGMENTS_MEASUREMENT_KIND } from "./types.js";
import { emitLayoutError, nonNegativeFinite } from "./utils.js";

/**
 * Create a graph-visible single-column text layout bundle.
 *
 * @param opts - Requires a graph and a graph-visible `measurements` node, plus optional
 *   `lineHeight`, `maxWidth`, `targetId`, `segmentAdapter`, and bundle `name`.
 * @returns A `ReactiveLayoutBundle` containing input nodes, setters, and graph-visible output
 *   nodes for segments, line breaks, height, and character positions.
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 * import {
 *   cellTextMeasurements,
 *   reactiveLayout,
 * } from "@graphrefly/ts/solutions/reactive-layout";
 *
 * const g = graph({ name: "article" });
 * const text = g.state("Hello GraphReFly", { name: "text" });
 * const font = g.state("16px system-ui", { name: "font" });
 * const measurements = cellTextMeasurements({ graph: g, text, font });
 *
 * const layout = reactiveLayout({ graph: g, measurements, maxWidth: 320, lineHeight: 20 });
 * layout.setMaxWidth(280);
 * ```
 * @remarks **Graph-visible:** This creates ordinary state/output nodes only; it does not add
 *   protocol behavior, hidden subscriptions, GraphSpec ownership, storage, or platform globals.
 * @category solutions
 */
export function reactiveLayout(opts: ReactiveLayoutOptions): ReactiveLayoutBundle {
	const { measurements, segmentAdapter: segmentAdapterOpt, name: suppliedName } = opts;
	const name = moduleName(opts.graph, suppliedName, "reactiveLayout");
	const targetId = opts.targetId ?? "text";
	const segAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = opts.graph;
	const lineHeightInput = inputNode(
		g,
		opts.lineHeight instanceof Node
			? opts.lineHeight
			: nonNegativeFinite(opts.lineHeight ?? 20, 20),
		nonNegativeFinite(20, 20),
		scopedName(name, "lineHeight"),
	);
	const maxWidthInput = inputNode(
		g,
		opts.maxWidth instanceof Node ? opts.maxWidth : nonNegativeFinite(opts.maxWidth ?? 800, 800),
		nonNegativeFinite(800, 800),
		scopedName(name, "maxWidth"),
	);
	const segments = g.node<readonly PreparedSegment[]>(
		[measurements],
		(ctx: Ctx) => {
			try {
				const measured = latestMeasurementValue<TextSegmentsMeasurement>(
					ctx.deps[0].value as Measurements,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
				);
				ctx.down([["DATA", measured?.segments ?? []]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout segments failed");
			}
		},
		{ name: scopedName(name, "segments") },
	);
	const lineBreaks = g.node<LineBreaksResult>(
		[segments, maxWidthInput.node, measurements],
		(ctx: Ctx) => {
			try {
				const measured = latestMeasurementValue<TextSegmentsMeasurement>(
					ctx.deps[2].value as Measurements,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
				);
				const computed = computeLineBreaks(
					ctx.deps[0].value as readonly PreparedSegment[],
					nonNegativeFinite(ctx.deps[1].value as number, 0),
					{ hyphenWidth: measured?.hyphenWidth, segmentAdapter: segAdapter },
				);
				ctx.down([["DATA", computed]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout line breaks failed");
			}
		},
		{ name: scopedName(name, "lineBreaks") },
	);
	const height = g.node<number>(
		[lineBreaks, lineHeightInput.node],
		(ctx: Ctx) => {
			try {
				const lines = ctx.deps[0].value as LineBreaksResult;
				const lineHeight = nonNegativeFinite(ctx.deps[1].value as number, 0);
				ctx.down([["DATA", lines.lineCount * lineHeight]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout height failed");
			}
		},
		{ name: scopedName(name, "height") },
	);
	const charPositions = g.node<readonly CharPosition[]>(
		[lineBreaks, segments, lineHeightInput.node],
		(ctx: Ctx) => {
			try {
				const positions = computeCharPositions(
					ctx.deps[0].value as LineBreaksResult,
					ctx.deps[1].value as readonly PreparedSegment[],
					nonNegativeFinite(ctx.deps[2].value as number, 0),
					segAdapter,
				);
				ctx.down([["DATA", positions]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout char positions failed");
			}
		},
		{ name: scopedName(name, "charPositions") },
	);
	return {
		graph: g,
		input: {
			lineHeight: lineHeightInput.node,
			maxWidth: maxWidthInput.node,
			measurements,
		},
		setLineHeight(lineHeight: number): void {
			lineHeightInput.set(nonNegativeFinite(lineHeight, 0));
		},
		setMaxWidth(maxWidth: number): void {
			maxWidthInput.set(nonNegativeFinite(maxWidth, 0));
		},
		segments,
		lineBreaks,
		height,
		charPositions,
	};
}

/**
 * Create a graph-visible vertical block layout bundle over the same DOM-free core.
 *
 * @param opts - Requires a graph and a graph-visible block `measurements` node, plus optional
 *   `gap`, `targetId`, and bundle `name`.
 * @returns A `ReactiveBlockLayoutBundle` containing the gap input, measured block output,
 *   positioned block flow, and total height node.
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 * import {
 *   blockAdaptersProvider,
 *   blockMeasurementProvider,
 *   reactiveBlockLayout,
 *   type MeasurementAdapter,
 * } from "@graphrefly/ts/solutions/reactive-layout";
 *
 * const g = graph({ name: "cards" });
 * const blocks = g.state([{ id: "title", kind: "text", text: "Hello" }]);
 * const maxWidth = g.state(320);
 * const text = g.state<MeasurementAdapter>({
 *   measureSegment: (segment) => ({ width: segment.length * 8 }),
 * });
 * const measurements = blockMeasurementProvider({
 *   graph: g,
 *   blocks,
 *   maxWidth,
 *   adapters: blockAdaptersProvider({ graph: g, text }),
 * });
 *
 * const layout = reactiveBlockLayout({ graph: g, measurements, gap: 12 });
 * layout.setGap(16);
 * ```
 * @remarks **DOM-free:** Image/SVG sizing is explicit or injected; no async image loading or
 *   DOM SVG parsing occurs in the core layout bundle.
 * @category solutions
 */
export function reactiveBlockLayout(opts: ReactiveBlockLayoutOptions): ReactiveBlockLayoutBundle {
	const { measurements, name: suppliedName } = opts;
	const name = moduleName(opts.graph, suppliedName, "reactiveBlockLayout");
	const targetId = opts.targetId ?? "blocks";
	const g = opts.graph;
	const gapInput = inputNode(
		g,
		opts.gap instanceof Node ? opts.gap : nonNegativeFinite(opts.gap ?? 0, 0),
		nonNegativeFinite(0, 0),
		scopedName(name, "gap"),
	);
	const measuredBlocks = g.node<readonly MeasuredBlock[]>(
		[measurements],
		(ctx: Ctx) => {
			try {
				const measured = latestMeasurementValue<BlocksMeasurement>(
					ctx.deps[0].value as Measurements,
					targetId,
					BLOCKS_MEASUREMENT_KIND,
				);
				ctx.down([["DATA", measured?.blocks ?? []]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout measured-blocks failed");
			}
		},
		{ name: scopedName(name, "measuredBlocks") },
	);
	const blockFlow = g.node<readonly PositionedBlock[]>(
		[measuredBlocks, gapInput.node],
		(ctx: Ctx) => {
			try {
				const positioned = computeBlockFlow(
					ctx.deps[0].value as readonly MeasuredBlock[],
					nonNegativeFinite(ctx.deps[1].value as number, 0),
				);
				ctx.down([["DATA", positioned]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout flow failed");
			}
		},
		{ name: scopedName(name, "flow") },
	);
	const totalHeight = g.node<number>(
		[blockFlow],
		(ctx: Ctx) => {
			try {
				ctx.down([["DATA", computeTotalHeight(ctx.deps[0].value as readonly PositionedBlock[])]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout total height failed");
			}
		},
		{ name: scopedName(name, "totalHeight") },
	);
	return {
		graph: g,
		input: {
			gap: gapInput.node,
			measurements,
		},
		setGap(gap: number): void {
			gapInput.set(nonNegativeFinite(gap, 0));
		},
		measuredBlocks,
		blockFlow,
		totalHeight,
	};
}

/** Create a graph-visible multi-column flow layout bundle with rectangle/circle obstacles.
 * @param opts - Options that configure the helper.
 * @returns A `ReactiveFlowLayoutBundle` value.
 * @category solutions
 * @example
 * ```ts
 * import { reactiveFlowLayout } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function reactiveFlowLayout(opts: ReactiveFlowLayoutOptions): ReactiveFlowLayoutBundle {
	const { measurements, segmentAdapter: segmentAdapterOpt, name: suppliedName } = opts;
	const name = moduleName(opts.graph, suppliedName, "reactiveFlowLayout");
	const targetId = opts.targetId ?? "text";
	const segAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = opts.graph;
	const lineHeightInput = inputNode(
		g,
		opts.lineHeight instanceof Node
			? opts.lineHeight
			: nonNegativeFinite(opts.lineHeight ?? 20, 20),
		nonNegativeFinite(20, 20),
		scopedName(name, "lineHeight"),
	);
	const containerInput = inputNode(
		g,
		opts.container,
		{ width: 800, height: 600 },
		scopedName(name, "container"),
	);
	const columnsInput = inputNode(
		g,
		opts.columns,
		{ count: 1, gap: 0 },
		scopedName(name, "columns"),
	);
	const obstaclesInput = inputNode(g, opts.obstacles, [], scopedName(name, "obstacles"));
	const segments = g.node<readonly PreparedSegment[]>(
		[measurements],
		(ctx: Ctx) => {
			try {
				const measured = latestMeasurementValue<TextSegmentsMeasurement>(
					ctx.deps[0].value as Measurements,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
				);
				ctx.down([["DATA", measured?.segments ?? []]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveFlowLayout segments failed");
			}
		},
		{ name: scopedName(name, "segments") },
	);
	const flowLines = g.node<FlowLinesResult>(
		[
			segments,
			lineHeightInput.node,
			containerInput.node,
			columnsInput.node,
			obstaclesInput.node,
			measurements,
		],
		(ctx: Ctx) => {
			try {
				const measured = latestMeasurementValue<TextSegmentsMeasurement>(
					ctx.deps[5].value as Measurements,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
				);
				const computed = computeFlowLines(ctx.deps[0].value as readonly PreparedSegment[], {
					lineHeight: nonNegativeFinite(ctx.deps[1].value as number, 0),
					container: sanitizeFlowContainer(ctx.deps[2].value as FlowContainer),
					columns: sanitizeFlowColumns(ctx.deps[3].value as FlowColumns),
					obstacles: sanitizeObstacles(ctx.deps[4].value as readonly Obstacle[]),
					minSlotWidth: nonNegativeFinite(opts.minSlotWidth ?? 0, 0),
					hyphenWidth: measured?.hyphenWidth,
					segmentAdapter: segAdapter,
				});
				ctx.down([["DATA", computed]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveFlowLayout flow lines failed");
			}
		},
		{ name: scopedName(name, "lines") },
	);
	return {
		graph: g,
		input: {
			lineHeight: lineHeightInput.node,
			container: containerInput.node,
			columns: columnsInput.node,
			obstacles: obstaclesInput.node,
			measurements,
		},
		setLineHeight(lineHeight: number): void {
			lineHeightInput.set(nonNegativeFinite(lineHeight, 0));
		},
		setContainer(container: FlowContainer): void {
			containerInput.set(container);
		},
		setColumns(columns: FlowColumns): void {
			columnsInput.set(columns);
		},
		setObstacles(obstacles: readonly Obstacle[]): void {
			obstaclesInput.set(obstacles);
		},
		segments,
		flowLines,
	};
}

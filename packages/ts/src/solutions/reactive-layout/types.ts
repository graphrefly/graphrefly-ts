import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";

/**
 * Synchronous text measurement contract for the D181 reactive-layout solution core.
 *
 * Implementations are injected by the caller; the universal subpath never imports DOM,
 * Canvas, React Native, storage, GraphSpec, or async image loading.
 */
export interface MeasurementAdapter {
	measureSegment(text: string, font: string): { readonly width: number };
	clearCache?(): void;
}

/** Caller-owned platform text capability, for NodeCanvas/Skia/RN-style wrappers. */
export interface TextMeasureCapability {
	measureText(text: string, font: string): number | { readonly width: number };
	clearCache?(): void;
}

/** One text segment returned by a caller-provided segmenter. */
export interface SegmentInfo {
	readonly segment: string;
	readonly index: number;
	readonly isWordLike?: boolean;
}

/** Synchronous word/grapheme segmentation contract for hosts without Intl.Segmenter. */
export interface SegmentAdapter {
	segmentWords(text: string): Iterable<SegmentInfo>;
	segmentGraphemes(text: string): Iterable<SegmentInfo>;
}

/** Layout segment class used by the line breaker. */
export type SegmentBreakKind = "text" | "space" | "zero-width-break" | "soft-hyphen" | "hard-break";

/** Measured text run consumed by pure line/block/flow helpers. */
export interface PreparedSegment {
	readonly text: string;
	readonly width: number;
	readonly kind: SegmentBreakKind;
	readonly graphemeWidths: readonly number[] | null;
}

/** One laid-out line with segment/grapheme cursor bounds. */
export interface LayoutLine {
	readonly text: string;
	readonly width: number;
	readonly startSegment: number;
	readonly startGrapheme: number;
	readonly endSegment: number;
	readonly endGrapheme: number;
}

/** Positioned grapheme box for hit testing or custom renderers. */
export interface CharPosition {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly line: number;
}

/** Result emitted by `reactiveLayout().lineBreaks`. */
export interface LineBreaksResult {
	readonly lines: readonly LayoutLine[];
	readonly lineCount: number;
}

/** Cursor into a prepared segment array. */
export interface LayoutCursor {
	readonly segmentIndex: number;
	readonly graphemeIndex: number;
}

/** Pure helper result for one `layoutNextLine` step. */
export interface LayoutNextLineResult {
	readonly text: string;
	readonly width: number;
	readonly start: LayoutCursor;
	readonly end: LayoutCursor;
}

/** Horizontal interval used by obstacle carving. */
export interface Interval {
	readonly left: number;
	readonly right: number;
}

export const TEXT_SEGMENTS_MEASUREMENT_KIND = "text-segments";
export const BLOCKS_MEASUREMENT_KIND = "blocks";
/** Measurement kind for standalone readiness facts. */
export const READINESS_MEASUREMENT_KIND = "readiness";
/** Measurement kind for standalone image-size facts. */
export const IMAGE_SIZE_MEASUREMENT_KIND = "image-size";
/** Measurement kind for standalone SVG-bounds facts. */
export const SVG_BOUNDS_MEASUREMENT_KIND = "svg-bounds";

export interface TextSegmentsMeasurement {
	readonly segments: readonly PreparedSegment[];
	readonly hyphenWidth?: number;
}

export interface BlocksMeasurement {
	readonly blocks: readonly MeasuredBlock[];
}

export interface MeasurementResult<T = unknown> {
	readonly kind: "ok";
	readonly targetId: string;
	readonly measurementKind: string;
	readonly value: T;
	readonly source?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface MeasurementIssue extends DataIssue {
	readonly subjectId: string;
	readonly measurementKind: string;
}

export type MeasurementFact<T = unknown> = MeasurementResult<T> | MeasurementIssue;

export type Measurements = readonly MeasurementFact[];

export interface MergeMeasurementsOptions {
	readonly graph: Graph;
	readonly sources: readonly Node<Measurements>[];
	readonly name?: string;
}

export interface TextMeasurementProviderOptions {
	readonly graph: Graph;
	readonly text: Node<string>;
	readonly font: Node<string>;
	readonly adapter: Node<MeasurementAdapter>;
	readonly segmentAdapter?: Node<SegmentAdapter>;
	readonly targetId?: string;
	readonly source?: string;
	readonly name?: string;
}

export interface InjectedTextMeasurementsOptions
	extends Omit<TextMeasurementProviderOptions, "adapter"> {
	readonly measure: MeasureFn;
	readonly cache?: boolean;
}

export interface PrecomputedTextMeasurementsOptions
	extends Omit<TextMeasurementProviderOptions, "adapter">,
		PrecomputedMeasureAdapterOptions {}

export interface CellTextMeasurementsOptions
	extends Omit<TextMeasurementProviderOptions, "adapter">,
		CellMeasureAdapterOptions {}

export interface CapabilityTextMeasurementsOptions
	extends Omit<TextMeasurementProviderOptions, "adapter"> {
	readonly capability: Node<TextMeasureCapability>;
}

export interface MeasurementReadiness {
	readonly ready: boolean;
	readonly code?: string;
	readonly message?: string;
	readonly source?: string;
	readonly details?: unknown;
	readonly metadata?: Record<string, unknown>;
}

/** Options for projecting readiness into graph-visible measurement facts. */
export interface ReadinessMeasurementsOptions {
	readonly graph: Graph;
	readonly readiness: Node<MeasurementReadiness>;
	readonly targetId?: string;
	readonly measurementKind?: string;
	readonly source?: string;
	readonly name?: string;
}

export interface ReadinessTextMeasurementsOptions extends TextMeasurementProviderOptions {
	readonly readiness: Node<MeasurementReadiness>;
}

/** Minimal caller-owned lookup for explicit image sizes. */
export interface ImageSizeLookup {
	get(src: string): Size | undefined;
}

/** One image-size fact target for `imageSizeMeasurements`. */
export interface ImageSizeMeasurementTarget {
	readonly id?: string;
	readonly src: string;
	readonly metadata?: Record<string, unknown>;
}

/** Options for projecting image-size facts from a caller-owned synchronous measurer. */
export interface ImageSizeMeasurementsOptions {
	readonly graph: Graph;
	readonly images: Node<readonly ImageSizeMeasurementTarget[]>;
	readonly measurer: Node<ImageMeasurer>;
	readonly measurementKind?: string;
	readonly source?: string;
	readonly name?: string;
}

/** One SVG-bounds fact target for `svgBoundsMeasurements`. */
export interface SvgBoundsMeasurementTarget {
	readonly id?: string;
	readonly svg: string;
	readonly metadata?: Record<string, unknown>;
}

/** Options for projecting SVG bounds from a caller-owned synchronous measurer. */
export interface SvgBoundsMeasurementsOptions {
	readonly graph: Graph;
	readonly svgs: Node<readonly SvgBoundsMeasurementTarget[]>;
	readonly measurer: Node<SvgMeasurer>;
	readonly measurementKind?: string;
	readonly source?: string;
	readonly name?: string;
}

export interface BlockMeasurementProviderOptions {
	readonly graph: Graph;
	readonly blocks: Node<readonly ContentBlock[]>;
	readonly maxWidth: Node<number>;
	readonly adapters: Node<BlockAdapters>;
	readonly segmentAdapter?: Node<SegmentAdapter>;
	readonly font?: Node<string>;
	readonly lineHeight?: Node<number>;
	readonly targetId?: string;
	readonly source?: string;
	readonly name?: string;
}

export interface BlockAdaptersProviderOptions {
	readonly graph: Graph;
	readonly text?: Node<MeasurementAdapter>;
	readonly svg?: Node<SvgMeasurer>;
	readonly image?: Node<ImageMeasurer>;
	readonly name?: string;
}

/**
 * Graph-visible bundle returned by `reactiveLayout`.
 *
 * The setters are state-node sugar over real graph inputs; the output nodes are ordinary
 * inspectable nodes visible through `graph.describe()`.
 */
export interface ReactiveLayoutBundle {
	readonly graph: Graph;
	readonly input: {
		readonly lineHeight: Node<number>;
		readonly maxWidth: Node<number>;
		readonly measurements: Node<Measurements>;
	};
	setLineHeight(lineHeight: number): void;
	setMaxWidth(maxWidth: number): void;
	readonly segments: Node<readonly PreparedSegment[]>;
	readonly lineBreaks: Node<LineBreaksResult>;
	readonly height: Node<number>;
	readonly charPositions: Node<readonly CharPosition[]>;
}

/** Optional context shared by pure line-breaking helpers. */
export interface LayoutNextLineContext {
	readonly adapter?: MeasurementAdapter;
	readonly font?: string;
	readonly cache?: Map<string, Map<string, number>>;
	readonly hyphenWidth?: number;
	readonly segmentAdapter?: SegmentAdapter;
}

/** Cache accounting object callers can pass into `analyzeAndMeasure`. */
export interface SegmentMeasureStats {
	hits: number;
	misses: number;
}

/** Options for the single-column reactive text layout bundle. */
export interface ReactiveLayoutOptions {
	readonly measurements: Node<Measurements>;
	readonly graph: Graph;
	readonly segmentAdapter?: SegmentAdapter;
	readonly targetId?: string;
	readonly name?: string;
	readonly lineHeight?: number | Node<number>;
	readonly maxWidth?: number | Node<number>;
}

/** Host text measurement function accepted by `InjectedMeasureAdapter`. */
export type MeasureFn = (text: string, font: string) => number | { readonly width: number };

/** Options for caller-injected synchronous measurement. */
export interface InjectedMeasureAdapterOptions {
	readonly cache?: boolean;
}

/** Options for deterministic precomputed text metrics. */
export interface PrecomputedMeasureAdapterOptions {
	readonly metrics: ReadonlyMap<string, number> | Record<string, number>;
	readonly fallback?: "per-char" | "error";
	readonly cellWidth?: number;
}

/** Fixed-cell measurement options for terminal/snapshot rendering. */
export interface CellMeasureAdapterOptions {
	readonly cellWidth?: number;
	readonly wideCellWidth?: number;
	readonly tabCells?: number;
}

/** Width/height pair in CSS-like pixels. */
export interface Size {
	readonly width: number;
	readonly height: number;
}

/** Synchronous SVG measurement seam; no DOM parser is provided by the core. */
export interface SvgMeasurer {
	measureSvg(svg: string): Size;
}

/** Synchronous image measurement seam; no loading/fetching is provided by the core. */
export interface ImageMeasurer {
	measureImage(src: string): Size;
}

/** Optional per-kind block measurement adapters. */
export interface BlockAdapters {
	readonly text?: MeasurementAdapter;
	readonly svg?: SvgMeasurer;
	readonly image?: ImageMeasurer;
}

/** Shared spacing/id fields for block layout inputs. */
export interface BaseContentBlock {
	readonly id?: string;
	readonly marginTop?: number;
	readonly marginBottom?: number;
}

/** Text block input for `measureBlock` and `reactiveBlockLayout`. */
export interface TextContentBlock extends BaseContentBlock {
	readonly kind: "text";
	readonly text: string;
	readonly font?: string;
	readonly lineHeight?: number;
	readonly maxWidth?: number;
}

/** Image block input with explicit dimensions or an injected `ImageMeasurer`. */
export interface ImageContentBlock extends BaseContentBlock {
	readonly kind: "image";
	readonly src: string;
	readonly width?: number;
	readonly height?: number;
	readonly maxWidth?: number;
}

/** SVG block input with explicit dimensions or an injected `SvgMeasurer`. */
export interface SvgContentBlock extends BaseContentBlock {
	readonly kind: "svg";
	readonly svg: string;
	readonly width?: number;
	readonly height?: number;
	readonly maxWidth?: number;
}

/** Heterogeneous block-layout input. */
export type ContentBlock = TextContentBlock | ImageContentBlock | SvgContentBlock;

/** Measured block produced by `measureBlock` or `measureBlocks`. */
export interface MeasuredBlock {
	readonly block: ContentBlock;
	readonly kind: ContentBlock["kind"];
	readonly id?: string;
	readonly width: number;
	readonly height: number;
	readonly marginTop: number;
	readonly marginBottom: number;
	readonly segments?: readonly PreparedSegment[];
	readonly lineBreaks?: LineBreaksResult;
	readonly charPositions?: readonly CharPosition[];
}

/** Block with vertical-flow coordinates. */
export interface PositionedBlock extends MeasuredBlock {
	readonly x: number;
	readonly y: number;
}

/** Options for pure block measurement helpers. */
export interface MeasureBlockOptions {
	readonly adapter?: MeasurementAdapter;
	readonly adapters?: BlockAdapters;
	readonly font?: string;
	readonly lineHeight?: number;
	readonly maxWidth?: number;
	readonly cache?: Map<string, Map<string, number>>;
	readonly hyphenWidth?: number;
	readonly segmentAdapter?: SegmentAdapter;
}

/** Options for the graph-visible block layout bundle. */
export interface ReactiveBlockLayoutOptions {
	readonly measurements: Node<Measurements>;
	readonly graph: Graph;
	readonly targetId?: string;
	readonly name?: string;
	readonly gap?: number | Node<number>;
}

/** Graph-visible vertical block layout bundle. */
export interface ReactiveBlockLayoutBundle {
	readonly graph: Graph;
	readonly input: {
		readonly gap: Node<number>;
		readonly measurements: Node<Measurements>;
	};
	setGap(gap: number): void;
	readonly measuredBlocks: Node<readonly MeasuredBlock[]>;
	readonly blockFlow: Node<readonly PositionedBlock[]>;
	readonly totalHeight: Node<number>;
}

/** Circular obstacle for flow layout slot carving. */
export interface CircleObstacle {
	readonly kind: "circle";
	readonly cx: number;
	readonly cy: number;
	readonly r: number;
}

/** Rectangular obstacle for flow layout slot carving. */
export interface RectObstacle {
	readonly kind: "rect";
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Obstacle shape accepted by flow layout. */
export type Obstacle = CircleObstacle | RectObstacle;

/** Flow container geometry. */
export interface FlowContainer {
	readonly width: number;
	readonly height: number;
	readonly paddingX?: number;
	readonly paddingY?: number;
}

/** Optional column geometry for flow layout. */
export interface FlowColumns {
	readonly count?: number;
	readonly gap?: number;
}

/** Positioned line emitted by `computeFlowLines` / `reactiveFlowLayout`. */
export interface PositionedLine extends LayoutLine {
	readonly x: number;
	readonly y: number;
	readonly slotWidth: number;
	readonly columnIndex: number;
}

/** Flow layout result plus the continuation cursor. */
export interface FlowLinesResult {
	readonly lines: readonly PositionedLine[];
	readonly cursor: LayoutCursor;
	readonly done: boolean;
}

/** Options for pure flow layout computation. */
export interface ComputeFlowLinesOptions {
	readonly container: FlowContainer;
	readonly columns?: FlowColumns;
	readonly obstacles?: readonly Obstacle[];
	readonly lineHeight: number;
	readonly minSlotWidth?: number;
	readonly hyphenWidth?: number;
	readonly segmentAdapter?: SegmentAdapter;
}

/** Options for the graph-visible flow layout bundle. */
export interface ReactiveFlowLayoutOptions {
	readonly measurements: Node<Measurements>;
	readonly graph: Graph;
	readonly segmentAdapter?: SegmentAdapter;
	readonly targetId?: string;
	readonly name?: string;
	readonly lineHeight?: number | Node<number>;
	readonly container?: FlowContainer | Node<FlowContainer>;
	readonly columns?: FlowColumns | Node<FlowColumns>;
	readonly obstacles?: readonly Obstacle[] | Node<readonly Obstacle[]>;
	readonly minSlotWidth?: number;
}

/** Graph-visible multi-column flow layout bundle. */
export interface ReactiveFlowLayoutBundle {
	readonly graph: Graph;
	readonly input: {
		readonly lineHeight: Node<number>;
		readonly container: Node<FlowContainer>;
		readonly columns: Node<FlowColumns>;
		readonly obstacles: Node<readonly Obstacle[]>;
		readonly measurements: Node<Measurements>;
	};
	setLineHeight(lineHeight: number): void;
	setContainer(container: FlowContainer): void;
	setColumns(columns: FlowColumns): void;
	setObstacles(obstacles: readonly Obstacle[]): void;
	readonly segments: Node<readonly PreparedSegment[]>;
	readonly flowLines: Node<FlowLinesResult>;
}

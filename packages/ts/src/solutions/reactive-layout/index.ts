import { type Ctx, depLatest } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph, StateNode } from "../../graph/graph.js";
import { Node } from "../../node/node.js";
import { errorPayload } from "../../protocol/messages.js";

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

const kinsokuStart = /* @__PURE__ */ new Set([
	"\u3001",
	"\u3002",
	"\u30FB",
	"\uFF09",
	"\u3015",
	"\u3009",
	"\u300B",
	"\u300D",
	"\u300F",
	"\u3011",
]);

const leftStickyPunctuation = /* @__PURE__ */ new Set([
	".",
	",",
	"!",
	"?",
	":",
	";",
	")",
	"]",
	"}",
	"%",
	'"',
	"\u201D",
	"\u2019",
	"\xBB",
	"\u203A",
	"\u2026",
]);

function isCJK(text: string): boolean {
	for (const ch of text) {
		const c = ch.codePointAt(0);
		if (
			(c !== undefined && c >= 19968 && c <= 40959) ||
			(c !== undefined && c >= 13312 && c <= 19903) ||
			(c !== undefined && c >= 12288 && c <= 12351) ||
			(c !== undefined && c >= 12352 && c <= 12447) ||
			(c !== undefined && c >= 44032 && c <= 55215) ||
			(c !== undefined && c >= 65280 && c <= 65519)
		) {
			return true;
		}
	}
	return false;
}

function normalizeWhitespace(text: string): string {
	return text.replace(/[\t\f ]+/g, " ").replace(/^ | $/g, "");
}

function segmentText(
	text: string,
	segmentAdapter: SegmentAdapter,
): {
	readonly texts: string[];
	readonly isWordLike: boolean[];
	readonly kinds: SegmentBreakKind[];
}[] {
	const pieces: {
		texts: string[];
		isWordLike: boolean[];
		kinds: SegmentBreakKind[];
	}[] = [];
	for (const s of segmentAdapter.segmentWords(text)) {
		const wordSegment = s.segment;
		const rawWordLike = s.isWordLike ?? false;
		const pieceTexts: string[] = [];
		const pieceWordLikes: boolean[] = [];
		const pieceKinds: SegmentBreakKind[] = [];
		let currentText = "";
		let currentKind: SegmentBreakKind | null = null;
		for (const ch of wordSegment) {
			let kind: SegmentBreakKind;
			if (ch === " ") {
				kind = "space";
			} else if (ch === "\u200B") {
				kind = "zero-width-break";
			} else if (ch === "\xAD") {
				kind = "soft-hyphen";
			} else if (ch === "\n") {
				kind = "hard-break";
			} else {
				kind = "text";
			}
			if (currentKind !== null && kind === currentKind) {
				currentText += ch;
			} else {
				if (currentKind !== null) {
					pieceTexts.push(currentText);
					pieceWordLikes.push(currentKind === "text" && rawWordLike);
					pieceKinds.push(currentKind);
				}
				currentText = ch;
				currentKind = kind;
			}
		}
		if (currentKind !== null) {
			pieceTexts.push(currentText);
			pieceWordLikes.push(currentKind === "text" && rawWordLike);
			pieceKinds.push(currentKind);
		}
		pieces.push({ texts: pieceTexts, isWordLike: pieceWordLikes, kinds: pieceKinds });
	}
	return pieces;
}

function* fallbackSegmentWords(text: string): Iterable<SegmentInfo> {
	let index = 0;
	let current = "";
	let currentIndex = 0;
	let currentWordLike: boolean | null = null;
	const flush = () => {
		if (current.length === 0 || currentWordLike === null) return undefined;
		const out = { segment: current, index: currentIndex, isWordLike: currentWordLike };
		current = "";
		currentWordLike = null;
		return out;
	};
	for (const ch of text) {
		const isWordLike = !/[\s\u200B\u00AD]/u.test(ch);
		if (currentWordLike !== null && currentWordLike !== isWordLike) {
			const out = flush();
			if (out) yield out;
		}
		if (currentWordLike === null) {
			currentWordLike = isWordLike;
			currentIndex = index;
		}
		current += ch;
		index += ch.length;
	}
	const out = flush();
	if (out) yield out;
}

function* fallbackSegmentGraphemes(text: string): Iterable<SegmentInfo> {
	let index = 0;
	for (const ch of text) {
		yield { segment: ch, index };
		index += ch.length;
	}
}

function createDefaultSegmentAdapter(): SegmentAdapter {
	return {
		segmentWords(text: string): Iterable<SegmentInfo> {
			return fallbackSegmentWords(text);
		},
		segmentGraphemes(text: string): Iterable<SegmentInfo> {
			return fallbackSegmentGraphemes(text);
		},
	};
}

let defaultSegmentAdapter: SegmentAdapter | null = null;

function getDefaultSegmentAdapter(): SegmentAdapter {
	if (defaultSegmentAdapter === null) {
		defaultSegmentAdapter = createDefaultSegmentAdapter();
	}
	return defaultSegmentAdapter;
}

function measuredWidth(value: number | { readonly width: number }): number {
	const width = typeof value === "number" ? value : value.width;
	return Number.isFinite(width) && width >= 0 ? width : 0;
}

function metricKey(text: string, font: string): string {
	return `${font}\0${text}`;
}

/** Adapter that wraps a caller-owned synchronous measurement function. */
export class InjectedMeasureAdapter implements MeasurementAdapter {
	private readonly measure: MeasureFn;
	private readonly shouldCache: boolean;
	private readonly cache = new Map<string, number>();

	constructor(measure: MeasureFn, opts: InjectedMeasureAdapterOptions = {}) {
		this.measure = measure;
		this.shouldCache = opts.cache ?? true;
	}

	measureSegment(text: string, font: string): { readonly width: number } {
		const key = metricKey(text, font);
		if (this.shouldCache) {
			const cached = this.cache.get(key);
			if (cached !== undefined) return { width: cached };
		}
		const width = measuredWidth(this.measure(text, font));
		if (this.shouldCache) this.cache.set(key, width);
		return { width };
	}

	clearCache(): void {
		this.cache.clear();
	}
}

/** Deterministic adapter backed by caller-supplied width metrics. */
export class PrecomputedMeasureAdapter implements MeasurementAdapter {
	private readonly metrics: ReadonlyMap<string, number>;
	private readonly fallback: "per-char" | "error";
	private readonly cellWidth: number;

	constructor(opts: PrecomputedMeasureAdapterOptions) {
		this.metrics =
			opts.metrics instanceof Map ? opts.metrics : new Map(Object.entries(opts.metrics));
		this.fallback = opts.fallback ?? "error";
		this.cellWidth = nonNegativeFinite(opts.cellWidth ?? 8, 8);
	}

	measureSegment(text: string, font: string): { readonly width: number } {
		const fontScoped = this.metrics.get(metricKey(text, font));
		if (fontScoped !== undefined) return { width: nonNegativeFinite(fontScoped, 0) };
		const unscoped = this.metrics.get(text);
		if (unscoped !== undefined) return { width: nonNegativeFinite(unscoped, 0) };
		if (this.fallback === "per-char") {
			return { width: Array.from(text).length * this.cellWidth };
		}
		throw new Error(`No precomputed metric for segment ${JSON.stringify(text)}`);
	}
}

/** Fixed-cell adapter for CLI, snapshots, and tests. */
export class CellMeasureAdapter implements MeasurementAdapter {
	private readonly cellWidth: number;
	private readonly wideCellWidth: number;
	private readonly tabCells: number;

	constructor(opts: CellMeasureAdapterOptions = {}) {
		this.cellWidth = nonNegativeFinite(opts.cellWidth ?? 8, 8);
		this.wideCellWidth = nonNegativeFinite(
			opts.wideCellWidth ?? this.cellWidth * 2,
			this.cellWidth * 2,
		);
		this.tabCells = Math.max(1, Math.floor(nonNegativeFinite(opts.tabCells ?? 4, 4)));
	}

	measureSegment(text: string): { readonly width: number } {
		let width = 0;
		for (const char of text) {
			if (char === "\t") width += this.cellWidth * this.tabCells;
			else width += isCJK(char) ? this.wideCellWidth : this.cellWidth;
		}
		return { width };
	}
}

/** Adapter over a caller-owned platform capability such as NodeCanvas, Skia, or RN text APIs. */
export class CapabilityMeasureAdapter implements MeasurementAdapter {
	private readonly capability: TextMeasureCapability;

	constructor(capability: TextMeasureCapability) {
		this.capability = capability;
	}

	measureSegment(text: string, font: string): { readonly width: number } {
		return { width: measuredWidth(this.capability.measureText(text, font)) };
	}

	clearCache(): void {
		this.capability.clearCache?.();
	}
}

function stripSvgIgnoredContent(svg: string): string {
	return svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
}

function readSvgRootTag(svg: string): string | null {
	return /<svg\b[^>]*>/i.exec(svg)?.[0] ?? null;
}

function readNumericAttr(tag: string, attr: string): number | null {
	const pattern = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*["']?(-?\\d+(?:\\.\\d+)?)`, "i");
	const match = pattern.exec(tag);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) && value >= 0 ? value : null;
}

function readViewBox(tag: string): Size | null {
	const match =
		/\bviewBox\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*["']/i.exec(
			tag,
		);
	if (!match) return null;
	const width = Number(match[3]);
	const height = Number(match[4]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
		return null;
	}
	return { width, height };
}

/**
 * Minimal string-based SVG bounds reader for explicit width/height or viewBox.
 *
 * This is not a DOM SVG parser and does not resolve external resources.
 */
export class SvgBoundsAdapter implements SvgMeasurer {
	measureSvg(svg: string): Size {
		const cleaned = stripSvgIgnoredContent(svg);
		const rootTag = readSvgRootTag(cleaned);
		if (rootTag === null) throw new Error("Cannot measure SVG without a root <svg> element");
		const width = readNumericAttr(rootTag, "width");
		const height = readNumericAttr(rootTag, "height");
		if (width !== null && height !== null) return { width, height };
		const viewBox = readViewBox(rootTag);
		if (viewBox) return viewBox;
		throw new Error("Cannot measure SVG without width/height or viewBox");
	}
}

/** Image measurer backed by explicit caller-provided dimensions; it never loads images. */
export class ImageSizeAdapter implements ImageMeasurer {
	private readonly sizes: ImageSizeLookup;

	constructor(sizes: ImageSizeLookup | Record<string, Size>) {
		this.sizes = isImageSizeLookup(sizes) ? sizes : new Map(Object.entries(sizes));
	}

	measureImage(src: string): Size {
		const size = this.sizes.get(src);
		if (!size) throw new Error(`No image size registered for ${JSON.stringify(src)}`);
		return size;
	}
}

function isImageSizeLookup(value: unknown): value is ImageSizeLookup {
	if (value === null) return false;
	const valueType = typeof value;
	if (valueType !== "object" && valueType !== "function") return false;
	return typeof (value as { readonly get?: unknown }).get === "function";
}

function measurementIssue(
	code: string,
	message: string,
	targetId: string,
	measurementKind: string,
	opts: {
		readonly source?: string;
		readonly details?: unknown;
		readonly metadata?: Record<string, unknown>;
		readonly severity?: DataIssue["severity"];
	} = {},
): MeasurementIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: opts.severity ?? "warning",
		source: opts.source,
		subjectId: targetId,
		measurementKind,
		details: opts.details,
		metadata: opts.metadata,
	};
}

function measurementOk<T>(
	targetId: string,
	measurementKind: string,
	value: T,
	opts: { readonly source?: string; readonly metadata?: Record<string, unknown> } = {},
): MeasurementResult<T> {
	return {
		kind: "ok",
		targetId,
		measurementKind,
		value,
		source: opts.source,
		metadata: opts.metadata,
	};
}

function latestMeasurementValue<T>(
	measurements: Measurements,
	targetId: string,
	measurementKind: string,
): T | undefined {
	let value: T | undefined;
	for (const fact of measurements) {
		if (
			fact.kind === "ok" &&
			fact.targetId === targetId &&
			fact.measurementKind === measurementKind
		) {
			value = fact.value as T;
		}
	}
	return value;
}

function tryMeasureHyphenWidth(adapter: MeasurementAdapter, font: string): number | undefined {
	try {
		return nonNegativeFinite(adapter.measureSegment("-", font).width, 0);
	} catch {
		return undefined;
	}
}

function validMeasurementSize(size: Size, label: string): Size {
	if (
		!Number.isFinite(size.width) ||
		!Number.isFinite(size.height) ||
		size.width < 0 ||
		size.height < 0
	) {
		throw new Error(`Invalid ${label} measurement size`);
	}
	return size;
}

function textMeasurementFacts(
	text: string,
	font: string,
	adapter: MeasurementAdapter,
	cache: Map<string, Map<string, number>>,
	segmentAdapter: SegmentAdapter,
	targetId: string,
	source: string,
): Measurements {
	try {
		const segments = analyzeAndMeasure(text, font, adapter, cache, undefined, segmentAdapter);
		const hyphenWidth = tryMeasureHyphenWidth(adapter, font);
		const facts: MeasurementFact<TextSegmentsMeasurement>[] = [
			measurementOk<TextSegmentsMeasurement>(
				targetId,
				TEXT_SEGMENTS_MEASUREMENT_KIND,
				hyphenWidth === undefined ? { segments } : { segments, hyphenWidth },
				{ source },
			),
		];
		if (hyphenWidth === undefined) {
			facts.push(
				measurementIssue(
					"measurement.hyphen.failed",
					`Hyphen measurement failed for '${targetId}'`,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
					{ source, severity: "warning" },
				),
			);
		}
		return facts;
	} catch (error) {
		return [
			measurementIssue(
				"measurement.failed",
				`Text measurement failed for '${targetId}'`,
				targetId,
				TEXT_SEGMENTS_MEASUREMENT_KIND,
				{ source, details: error, severity: "error" },
			),
		];
	}
}

function inputNode<T>(
	g: Graph,
	input: T | Node<T> | undefined,
	fallback: T,
	name: string,
): { readonly node: Node<T>; readonly set: (value: T) => void } {
	if (input instanceof Node) {
		return {
			node: input,
			set(value: T): void {
				const maybeState = input as Node<T> & { set?: (next: T) => void };
				if (typeof maybeState.set !== "function") {
					throw new TypeError(`reactive-layout input '${name}' is not a writable state node`);
				}
				maybeState.set(value);
			},
		};
	}
	const state: StateNode<T> = g.state(input ?? fallback, { name });
	return { node: state, set: (value: T) => state.set(value) };
}

function scopedName(scope: string, local: string): string {
	return scope === local ? local : `${scope}:${local}`;
}

/** Generic sync text measurement provider that emits graph-visible measurement facts. */
export function textMeasurementProvider(opts: TextMeasurementProviderOptions): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	const cache = new Map<string, Map<string, number>>();
	let activeAdapter: MeasurementAdapter | null = null;
	return opts.graph.node<Measurements>(
		opts.segmentAdapter
			? [opts.text, opts.font, opts.adapter, opts.segmentAdapter]
			: [opts.text, opts.font, opts.adapter],
		(ctx: Ctx) => {
			const flush = () => {
				cache.clear();
				(depLatest(ctx, 2) as MeasurementAdapter).clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			const text = depLatest(ctx, 0) as string;
			const font = depLatest(ctx, 1) as string;
			const adapter = depLatest(ctx, 2) as MeasurementAdapter;
			if (adapter !== activeAdapter) {
				cache.clear();
				activeAdapter = adapter;
			}
			const segmentAdapter =
				opts.segmentAdapter === undefined
					? getDefaultSegmentAdapter()
					: (depLatest(ctx, 3) as SegmentAdapter);
			ctx.down([
				[
					"DATA",
					textMeasurementFacts(text, font, adapter, cache, segmentAdapter, targetId, source),
				],
			]);
		},
		{ name },
	);
}

/** Provider helper for caller-injected synchronous text measurement. */
export function injectedTextMeasurements(
	opts: InjectedTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.state<MeasurementAdapter>(
		new InjectedMeasureAdapter(opts.measure, { cache: opts.cache }),
		{
			name: opts.name
				? scopedName(opts.name, "measure-capability")
				: `${targetId}-measure-capability`,
		},
	);
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "injectedTextMeasurements",
	});
}

/** Provider helper for deterministic precomputed text metrics. */
export function precomputedTextMeasurements(
	opts: PrecomputedTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.state<MeasurementAdapter>(new PrecomputedMeasureAdapter(opts), {
		name: opts.name
			? scopedName(opts.name, "measure-capability")
			: `${targetId}-measure-capability`,
	});
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "precomputedTextMeasurements",
	});
}

/** Provider helper for fixed-cell terminal/snapshot text measurement. */
export function cellTextMeasurements(opts: CellTextMeasurementsOptions): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.state<MeasurementAdapter>(new CellMeasureAdapter(opts), {
		name: opts.name
			? scopedName(opts.name, "measure-capability")
			: `${targetId}-measure-capability`,
	});
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "cellTextMeasurements",
	});
}

/** Provider helper for caller-injected platform text capability nodes. */
export function capabilityTextMeasurements(
	opts: CapabilityTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.node<MeasurementAdapter>(
		[opts.capability],
		(ctx: Ctx) => {
			ctx.down([
				["DATA", new CapabilityMeasureAdapter(depLatest(ctx, 0) as TextMeasureCapability)],
			]);
		},
		{
			name: opts.name
				? scopedName(opts.name, "measure-capability")
				: `${targetId}-measure-capability`,
		},
	);
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "capabilityTextMeasurements",
	});
}

/** Provider helper that makes readiness facts an explicit measurement dependency. */
export function readinessTextMeasurements(
	opts: ReadinessTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	const cache = new Map<string, Map<string, number>>();
	let activeAdapter: MeasurementAdapter | null = null;
	let activeReadiness: MeasurementReadiness | null = null;
	const deps = opts.segmentAdapter
		? [opts.text, opts.font, opts.adapter, opts.readiness, opts.segmentAdapter]
		: [opts.text, opts.font, opts.adapter, opts.readiness];
	return opts.graph.node<Measurements>(
		deps,
		(ctx: Ctx) => {
			const flush = () => {
				cache.clear();
				(depLatest(ctx, 2) as MeasurementAdapter).clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			const text = depLatest(ctx, 0) as string;
			const font = depLatest(ctx, 1) as string;
			const adapter = depLatest(ctx, 2) as MeasurementAdapter;
			if (adapter !== activeAdapter) {
				cache.clear();
				activeAdapter = adapter;
			}
			const readiness = depLatest(ctx, 3) as MeasurementReadiness;
			if (readiness !== activeReadiness) {
				cache.clear();
				activeReadiness = readiness;
			}
			if (!readiness.ready) {
				ctx.down([
					[
						"DATA",
						[
							measurementIssue(
								readiness.code ?? "measurement.not-ready",
								readiness.message ?? `Measurement readiness blocked '${targetId}'`,
								targetId,
								TEXT_SEGMENTS_MEASUREMENT_KIND,
								{
									source: readiness.source ?? source,
									details: readiness.details,
									metadata: readiness.metadata,
									severity: "warning",
								},
							),
						],
					],
				]);
				return;
			}
			const segmentAdapter =
				opts.segmentAdapter === undefined
					? getDefaultSegmentAdapter()
					: (depLatest(ctx, 4) as SegmentAdapter);
			ctx.down([
				[
					"DATA",
					textMeasurementFacts(text, font, adapter, cache, segmentAdapter, targetId, source),
				],
			]);
		},
		{ name },
	);
}

/** Provider helper that emits graph-visible readiness facts without measuring layout. */
export function readinessMeasurements(opts: ReadinessMeasurementsOptions): Node<Measurements> {
	const targetId = opts.targetId ?? "measurement-readiness";
	const measurementKind = opts.measurementKind ?? READINESS_MEASUREMENT_KIND;
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	return opts.graph.node<Measurements>(
		[opts.readiness],
		(ctx: Ctx) => {
			const readiness = depLatest(ctx, 0) as MeasurementReadiness;
			if (!readiness.ready) {
				ctx.down([
					[
						"DATA",
						[
							measurementIssue(
								readiness.code ?? "measurement.not-ready",
								readiness.message ?? `Measurement readiness blocked '${targetId}'`,
								targetId,
								measurementKind,
								{
									source: readiness.source ?? source,
									details: readiness.details,
									metadata: readiness.metadata,
									severity: "warning",
								},
							),
						],
					],
				]);
				return;
			}
			ctx.down([
				[
					"DATA",
					[
						measurementOk<MeasurementReadiness>(targetId, measurementKind, readiness, {
							source: readiness.source ?? source,
							metadata: readiness.metadata,
						}),
					],
				],
			]);
		},
		{ name },
	);
}

/** Provider helper for image-size facts from caller-owned synchronous image measurers. */
export function imageSizeMeasurements(opts: ImageSizeMeasurementsOptions): Node<Measurements> {
	const measurementKind = opts.measurementKind ?? IMAGE_SIZE_MEASUREMENT_KIND;
	const name = opts.name ?? "image-size-measurements";
	const source = opts.source ?? name;
	return opts.graph.node<Measurements>(
		[opts.images, opts.measurer],
		(ctx: Ctx) => {
			const images = depLatest(ctx, 0) as readonly ImageSizeMeasurementTarget[];
			const measurer = depLatest(ctx, 1) as ImageMeasurer;
			const facts: MeasurementFact<Size>[] = [];
			for (let i = 0; i < images.length; i += 1) {
				const image = (images as readonly (ImageSizeMeasurementTarget | undefined)[])[i];
				const subjectId = image?.id ?? image?.src ?? `image:${i}`;
				try {
					if (image === undefined) throw new Error(`Missing image target at index ${i}`);
					facts.push(
						measurementOk<Size>(
							subjectId,
							measurementKind,
							validMeasurementSize(measurer.measureImage(image.src), "image"),
							{
								source,
								metadata: image.metadata,
							},
						),
					);
				} catch (error) {
					facts.push(
						measurementIssue(
							"measurement.image-size.failed",
							`Image size measurement failed for '${subjectId}'`,
							subjectId,
							measurementKind,
							{
								source,
								details: { error, index: i, src: image?.src },
								metadata: image?.metadata,
								severity: "error",
							},
						),
					);
				}
			}
			ctx.down([["DATA", facts]]);
		},
		{ name },
	);
}

/** Provider helper for SVG bounds facts from caller-owned synchronous SVG measurers. */
export function svgBoundsMeasurements(opts: SvgBoundsMeasurementsOptions): Node<Measurements> {
	const measurementKind = opts.measurementKind ?? SVG_BOUNDS_MEASUREMENT_KIND;
	const name = opts.name ?? "svg-bounds-measurements";
	const source = opts.source ?? name;
	return opts.graph.node<Measurements>(
		[opts.svgs, opts.measurer],
		(ctx: Ctx) => {
			const svgs = depLatest(ctx, 0) as readonly SvgBoundsMeasurementTarget[];
			const measurer = depLatest(ctx, 1) as SvgMeasurer;
			const facts: MeasurementFact<Size>[] = [];
			for (let i = 0; i < svgs.length; i += 1) {
				const svg = (svgs as readonly (SvgBoundsMeasurementTarget | undefined)[])[i];
				const subjectId = svg?.id ?? `svg:${i}`;
				try {
					if (svg === undefined) throw new Error(`Missing SVG target at index ${i}`);
					facts.push(
						measurementOk<Size>(
							subjectId,
							measurementKind,
							validMeasurementSize(measurer.measureSvg(svg.svg), "SVG"),
							{
								source,
								metadata: svg.metadata,
							},
						),
					);
				} catch (error) {
					facts.push(
						measurementIssue(
							"measurement.svg-bounds.failed",
							`SVG bounds measurement failed for '${subjectId}'`,
							subjectId,
							measurementKind,
							{
								source,
								details: { error, index: i },
								metadata: svg?.metadata,
								severity: "error",
							},
						),
					);
				}
			}
			ctx.down([["DATA", facts]]);
		},
		{ name },
	);
}

/** Compose optional block measurement capability nodes into one graph-visible adapter node. */
export function blockAdaptersProvider(opts: BlockAdaptersProviderOptions): Node<BlockAdapters> {
	const deps: Node<unknown>[] = [];
	const positions: { text?: number; svg?: number; image?: number } = {};
	if (opts.text) {
		positions.text = deps.length;
		deps.push(opts.text);
	}
	if (opts.svg) {
		positions.svg = deps.length;
		deps.push(opts.svg);
	}
	if (opts.image) {
		positions.image = deps.length;
		deps.push(opts.image);
	}
	return opts.graph.node<BlockAdapters>(
		deps,
		(ctx: Ctx) => {
			const adapters: BlockAdapters = {
				text:
					positions.text === undefined
						? undefined
						: (depLatest(ctx, positions.text) as MeasurementAdapter),
				svg:
					positions.svg === undefined ? undefined : (depLatest(ctx, positions.svg) as SvgMeasurer),
				image:
					positions.image === undefined
						? undefined
						: (depLatest(ctx, positions.image) as ImageMeasurer),
			};
			ctx.down([["DATA", adapters]]);
		},
		{ name: opts.name ?? "block-adapters" },
	);
}

/** Provider helper for block measurement facts over declared block/max-width deps. */
export function blockMeasurementProvider(
	opts: BlockMeasurementProviderOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "blocks";
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	const cache = new Map<string, Map<string, number>>();
	let activeTextAdapter: MeasurementAdapter | undefined;
	const deps = [opts.blocks, opts.maxWidth, opts.adapters] as Node<unknown>[];
	if (opts.font) deps.push(opts.font);
	if (opts.lineHeight) deps.push(opts.lineHeight);
	if (opts.segmentAdapter) deps.push(opts.segmentAdapter);
	return opts.graph.node<Measurements>(
		deps,
		(ctx: Ctx) => {
			const flush = () => {
				cache.clear();
				const adapters = depLatest(ctx, 2) as BlockAdapters;
				adapters.text?.clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			try {
				const blocks = depLatest(ctx, 0) as readonly ContentBlock[];
				const maxWidth = nonNegativeFinite(depLatest(ctx, 1) as number, 0);
				const adapters = depLatest(ctx, 2) as BlockAdapters;
				if (adapters.text !== activeTextAdapter) {
					cache.clear();
					activeTextAdapter = adapters.text;
				}
				let depIndex = 3;
				const font = opts.font ? (depLatest(ctx, depIndex++) as string) : undefined;
				const lineHeight = opts.lineHeight
					? nonNegativeFinite(depLatest(ctx, depIndex++) as number, 0)
					: undefined;
				const segmentAdapter = opts.segmentAdapter
					? (depLatest(ctx, depIndex) as SegmentAdapter)
					: getDefaultSegmentAdapter();
				const measured: MeasuredBlock[] = [];
				const issues: MeasurementIssue[] = [];
				for (let i = 0; i < blocks.length; i += 1) {
					const block = (blocks as readonly (ContentBlock | undefined)[])[i];
					const subjectId = block?.id ?? `${targetId}:${i}`;
					try {
						if (block === undefined) {
							throw new Error(`Missing content block at index ${i}`);
						}
						const blockFont =
							block.kind === "text" ? (block.font ?? font ?? "16px sans-serif") : undefined;
						const hyphenWidth =
							block.kind === "text" && adapters.text
								? tryMeasureHyphenWidth(adapters.text, blockFont ?? "16px sans-serif")
								: undefined;
						measured.push(
							measureBlock(block, {
								adapters,
								font,
								hyphenWidth,
								lineHeight,
								maxWidth,
								cache,
								segmentAdapter,
							}),
						);
						if (block.kind === "text" && adapters.text) {
							if (hyphenWidth === undefined) {
								issues.push(
									measurementIssue(
										"measurement.hyphen.failed",
										`Hyphen measurement failed for '${subjectId}'`,
										subjectId,
										BLOCKS_MEASUREMENT_KIND,
										{
											source,
											details: { targetId, index: i },
											severity: "warning",
										},
									),
								);
							}
						}
					} catch (error) {
						issues.push(
							measurementIssue(
								"measurement.block.failed",
								`Block measurement failed for '${subjectId}'`,
								subjectId,
								BLOCKS_MEASUREMENT_KIND,
								{
									source,
									details: { error, targetId, index: i, blockKind: block?.kind },
									severity: "error",
								},
							),
						);
					}
				}
				ctx.down([
					[
						"DATA",
						[
							measurementOk<BlocksMeasurement>(
								targetId,
								BLOCKS_MEASUREMENT_KIND,
								{ blocks: measured },
								{ source },
							),
							...issues,
						],
					],
				]);
			} catch (error) {
				ctx.down([
					[
						"DATA",
						[
							measurementIssue(
								"measurement.failed",
								`Block measurement failed for '${targetId}'`,
								targetId,
								BLOCKS_MEASUREMENT_KIND,
								{ source, details: error, severity: "error" },
							),
						],
					],
				]);
			}
		},
		{ name },
	);
}

/** Segment text and measure every resulting segment with a caller-owned synchronous adapter. */
export function analyzeAndMeasure(
	text: string,
	font: string,
	adapter: MeasurementAdapter,
	cache: Map<string, Map<string, number>>,
	stats?: SegmentMeasureStats,
	segmentAdapter?: SegmentAdapter,
): PreparedSegment[] {
	const normalized = normalizeWhitespace(text);
	if (normalized.length === 0) {
		return [];
	}
	const segAdapter = segmentAdapter ?? getDefaultSegmentAdapter();
	const pieces = segmentText(normalized, segAdapter);
	const rawTexts: string[] = [];
	const rawKinds: SegmentBreakKind[] = [];
	const rawWordLike: boolean[] = [];
	for (const piece of pieces) {
		for (let i = 0; i < piece.texts.length; i += 1) {
			rawTexts.push(piece.texts[i]);
			rawKinds.push(piece.kinds[i]);
			rawWordLike.push(piece.isWordLike[i]);
		}
	}
	const mergedTexts: string[] = [];
	const mergedKinds: SegmentBreakKind[] = [];
	const mergedWordLike: boolean[] = [];
	for (let i = 0; i < rawTexts.length; i += 1) {
		const t = rawTexts[i];
		const k = rawKinds[i];
		const wl = rawWordLike[i];
		if (
			k === "text" &&
			!wl &&
			mergedTexts.length > 0 &&
			mergedKinds[mergedTexts.length - 1] === "text"
		) {
			const isSticky = t.length === 1 && (leftStickyPunctuation.has(t) || kinsokuStart.has(t));
			if (isSticky) {
				mergedTexts[mergedTexts.length - 1] += t;
				continue;
			}
		}
		if (
			t === "-" &&
			mergedTexts.length > 0 &&
			mergedKinds[mergedKinds.length - 1] === "text" &&
			mergedWordLike[mergedWordLike.length - 1]
		) {
			mergedTexts[mergedTexts.length - 1] += t;
			continue;
		}
		mergedTexts.push(t);
		mergedKinds.push(k);
		mergedWordLike.push(wl);
	}
	const fontCache = cache.get(font) ?? new Map<string, number>();
	if (!cache.has(font)) cache.set(font, fontCache);
	function measureCached(segment: string): number {
		const cached = fontCache.get(segment);
		if (cached === undefined) {
			if (stats) stats.misses += 1;
			const measured = adapter.measureSegment(segment, font).width;
			const width = Number.isFinite(measured) && measured >= 0 ? measured : 0;
			fontCache.set(segment, width);
			return width;
		}
		if (stats) stats.hits += 1;
		return cached;
	}
	const out: PreparedSegment[] = [];
	for (let i = 0; i < mergedTexts.length; i += 1) {
		const t = mergedTexts[i];
		const kind = mergedKinds[i];
		if (kind !== "text") {
			out.push({
				text: t,
				width: kind === "space" ? measureCached(" ") * t.length : 0,
				kind,
				graphemeWidths: null,
			});
			continue;
		}
		if (isCJK(t)) {
			let unitText = "";
			for (const graphemeSegment of segAdapter.segmentGraphemes(t)) {
				const grapheme = graphemeSegment.segment;
				if (unitText.length > 0 && kinsokuStart.has(grapheme)) {
					unitText += grapheme;
					continue;
				}
				if (unitText.length > 0) {
					out.push({
						text: unitText,
						width: measureCached(unitText),
						kind: "text",
						graphemeWidths: null,
					});
				}
				unitText = grapheme;
			}
			if (unitText.length > 0) {
				out.push({
					text: unitText,
					width: measureCached(unitText),
					kind: "text",
					graphemeWidths: null,
				});
			}
			continue;
		}
		const textWidth = measureCached(t);
		let graphemeWidths: number[] | null = null;
		if (mergedWordLike[i] && t.length > 1) {
			const widths = [];
			for (const grapheme of segAdapter.segmentGraphemes(t)) {
				widths.push(measureCached(grapheme.segment));
			}
			if (widths.length > 1) graphemeWidths = widths;
		}
		out.push({
			text: t,
			width: textWidth,
			kind: "text",
			graphemeWidths,
		});
	}
	return out;
}

/** Greedy single-column line breaking over prepared segments. */
export function computeLineBreaks(
	segments: readonly PreparedSegment[],
	maxWidth: number,
	opts: { readonly hyphenWidth?: number; readonly segmentAdapter?: SegmentAdapter } = {},
): LineBreaksResult {
	if (segments.length === 0) return { lines: [], lineCount: 0 };
	const segAdapter = opts.segmentAdapter ?? getDefaultSegmentAdapter();
	const lines: LayoutLine[] = [];
	let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
	while (cursor.segmentIndex < segments.length) {
		const next = layoutNextLine(segments, cursor, maxWidth, {
			hyphenWidth: opts.hyphenWidth,
			segmentAdapter: segAdapter,
		});
		if (next === null) break;
		lines.push({
			text: next.text,
			width: next.width,
			startSegment: next.start.segmentIndex,
			startGrapheme: next.start.graphemeIndex,
			endSegment: next.end.segmentIndex,
			endGrapheme: next.end.graphemeIndex,
		});
		if (
			next.end.segmentIndex === cursor.segmentIndex &&
			next.end.graphemeIndex === cursor.graphemeIndex
		) {
			break;
		}
		cursor = next.end;
	}
	return { lines, lineCount: lines.length };
}

function canBreakAfter(kind: SegmentBreakKind): boolean {
	return kind === "space" || kind === "zero-width-break" || kind === "soft-hyphen";
}

function sliceSegmentText(
	seg: PreparedSegment,
	startGrapheme: number,
	endGrapheme: number,
	segmentAdapter: SegmentAdapter,
): string {
	if (startGrapheme === 0 && endGrapheme < 0) return seg.text;
	const graphemes = [...segmentAdapter.segmentGraphemes(seg.text)].map((g) => g.segment);
	const stop = endGrapheme < 0 ? graphemes.length : endGrapheme;
	return graphemes.slice(startGrapheme, stop).join("");
}

function buildLineText(
	segments: readonly PreparedSegment[],
	startSegment: number,
	startGrapheme: number,
	endSegment: number,
	endGrapheme: number,
	appendHyphen: boolean,
	segmentAdapter: SegmentAdapter,
): string {
	let text = "";
	for (let i = startSegment; i < endSegment; i += 1) {
		const seg = segments[i];
		if (seg.kind === "soft-hyphen" || seg.kind === "hard-break") continue;
		if (i === startSegment && startGrapheme > 0) {
			text += sliceSegmentText(seg, startGrapheme, -1, segmentAdapter);
		} else {
			text += seg.text;
		}
	}
	if (endGrapheme > 0 && endSegment < segments.length) {
		const seg = segments[endSegment];
		const from = startSegment === endSegment ? startGrapheme : 0;
		text += sliceSegmentText(seg, from, endGrapheme, segmentAdapter);
	}
	if (appendHyphen) text += "-";
	return text;
}

function resolveHyphenWidth(ctx: LayoutNextLineContext | undefined): number {
	if (ctx?.hyphenWidth !== undefined) return nonNegativeFinite(ctx.hyphenWidth, 0);
	if (ctx?.adapter === undefined || ctx.font === undefined) return 0;
	const cache = ctx.cache;
	if (cache) {
		let fontCache = cache.get(ctx.font);
		if (fontCache === undefined) {
			fontCache = new Map();
			cache.set(ctx.font, fontCache);
		}
		let width = fontCache.get("-");
		if (width === undefined) {
			width = ctx.adapter.measureSegment("-", ctx.font).width;
			fontCache.set("-", width);
		}
		return width;
	}
	return ctx.adapter.measureSegment("-", ctx.font).width;
}

/** Lay out one line from a cursor, returning the next cursor for continuation. */
export function layoutNextLine(
	segments: readonly PreparedSegment[],
	cursor: LayoutCursor,
	slotWidth: number,
	ctx?: LayoutNextLineContext,
): LayoutNextLineResult | null {
	let i = cursor.segmentIndex;
	const initialGrapheme = cursor.graphemeIndex;
	const segmentAdapter = ctx?.segmentAdapter ?? getDefaultSegmentAdapter();
	if (i >= segments.length) return null;
	if (initialGrapheme === 0) {
		while (i < segments.length) {
			const seg = segments[i];
			if (seg.kind === "hard-break") {
				return {
					text: "",
					width: 0,
					start: { segmentIndex: cursor.segmentIndex, graphemeIndex: 0 },
					end: { segmentIndex: i + 1, graphemeIndex: 0 },
				};
			}
			if (seg.kind === "space" || seg.kind === "zero-width-break" || seg.kind === "soft-hyphen") {
				i += 1;
				continue;
			}
			break;
		}
		if (i >= segments.length) return null;
	}
	const hyphenWidth = resolveHyphenWidth(ctx);
	const startSegment = i;
	const startGrapheme = i === cursor.segmentIndex ? initialGrapheme : 0;
	let lineW = 0;
	let lineEndSegment = startSegment;
	let lineEndGrapheme = 0;
	let hasContent = false;
	let pendingBreakSegment = -1;
	let pendingBreakGrapheme = 0;
	let pendingBreakWidth = 0;
	let pendingBreakSoftHyphen = false;
	const recordPending = (
		sIdx: number,
		gIdx: number,
		width: number,
		kind: SegmentBreakKind,
	): void => {
		pendingBreakSegment = sIdx;
		pendingBreakGrapheme = gIdx;
		pendingBreakWidth = width;
		pendingBreakSoftHyphen = kind === "soft-hyphen";
	};
	const consumeBreakable = (segIdx: number, startG: number, widths: readonly number[]): boolean => {
		for (let g = startG; g < widths.length; g += 1) {
			const gw = widths[g];
			if (!hasContent) {
				lineW = gw;
				lineEndSegment = segIdx;
				lineEndGrapheme = g + 1;
				hasContent = true;
				continue;
			}
			if (lineW + gw > slotWidth + 1e-3) {
				return true;
			}
			lineW += gw;
			lineEndSegment = segIdx;
			lineEndGrapheme = g + 1;
		}
		if (lineEndSegment === segIdx && lineEndGrapheme === widths.length) {
			lineEndSegment = segIdx + 1;
			lineEndGrapheme = 0;
		}
		return false;
	};
	if (startGrapheme > 0 && startSegment < segments.length) {
		const seg = segments[startSegment];
		if (seg.graphemeWidths) {
			const overflow = consumeBreakable(startSegment, startGrapheme, seg.graphemeWidths);
			if (overflow) {
				const text = buildLineText(
					segments,
					startSegment,
					startGrapheme,
					lineEndSegment,
					lineEndGrapheme,
					false,
					segmentAdapter,
				);
				return {
					text,
					width: lineW,
					start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
					end: { segmentIndex: lineEndSegment, graphemeIndex: lineEndGrapheme },
				};
			}
			i = lineEndSegment;
		}
	}
	for (; i < segments.length; i += 1) {
		const seg = segments[i];
		if (seg.kind === "hard-break") {
			if (hasContent) {
				const endsAtSoftHyphen =
					lineEndSegment > 0 && segments[lineEndSegment - 1]?.kind === "soft-hyphen";
				const text = buildLineText(
					segments,
					startSegment,
					startGrapheme,
					lineEndSegment,
					lineEndGrapheme,
					endsAtSoftHyphen,
					segmentAdapter,
				);
				return {
					text,
					width: lineW + (endsAtSoftHyphen ? hyphenWidth : 0),
					start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
					end: { segmentIndex: i + 1, graphemeIndex: 0 },
				};
			}
			return {
				text: "",
				width: 0,
				start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
				end: { segmentIndex: i + 1, graphemeIndex: 0 },
			};
		}
		const w = seg.width;
		if (!hasContent) {
			if (w > slotWidth && seg.graphemeWidths) {
				const overflow = consumeBreakable(i, 0, seg.graphemeWidths);
				if (overflow) {
					const text = buildLineText(
						segments,
						startSegment,
						startGrapheme,
						lineEndSegment,
						lineEndGrapheme,
						false,
						segmentAdapter,
					);
					return {
						text,
						width: lineW,
						start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
						end: { segmentIndex: lineEndSegment, graphemeIndex: lineEndGrapheme },
					};
				}
				i = lineEndSegment - 1;
				continue;
			}
			lineW = w;
			lineEndSegment = i + 1;
			lineEndGrapheme = 0;
			hasContent = true;
			if (canBreakAfter(seg.kind)) {
				recordPending(i + 1, 0, seg.kind === "space" ? lineW - w : lineW, seg.kind);
			}
			continue;
		}
		const projectedWidth = lineW + w;
		if (projectedWidth > slotWidth + 1e-3) {
			if (canBreakAfter(seg.kind)) {
				lineEndSegment = i + 1;
				lineEndGrapheme = 0;
				const endsAtSoftHyphen = seg.kind === "soft-hyphen";
				const text = buildLineText(
					segments,
					startSegment,
					startGrapheme,
					lineEndSegment,
					lineEndGrapheme,
					endsAtSoftHyphen,
					segmentAdapter,
				);
				return {
					text,
					width: seg.kind === "space" ? lineW : lineW + (endsAtSoftHyphen ? hyphenWidth : 0),
					start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
					end: { segmentIndex: lineEndSegment, graphemeIndex: lineEndGrapheme },
				};
			}
			if (pendingBreakSegment >= 0) {
				const text = buildLineText(
					segments,
					startSegment,
					startGrapheme,
					pendingBreakSegment,
					pendingBreakGrapheme,
					pendingBreakSoftHyphen,
					segmentAdapter,
				);
				return {
					text,
					width: pendingBreakWidth + (pendingBreakSoftHyphen ? hyphenWidth : 0),
					start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
					end: { segmentIndex: pendingBreakSegment, graphemeIndex: pendingBreakGrapheme },
				};
			}
			if (w > slotWidth && seg.graphemeWidths) {
				const text = buildLineText(
					segments,
					startSegment,
					startGrapheme,
					lineEndSegment,
					lineEndGrapheme,
					false,
					segmentAdapter,
				);
				return {
					text,
					width: lineW,
					start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
					end: { segmentIndex: lineEndSegment, graphemeIndex: lineEndGrapheme },
				};
			}
			const text = buildLineText(
				segments,
				startSegment,
				startGrapheme,
				lineEndSegment,
				lineEndGrapheme,
				false,
				segmentAdapter,
			);
			return {
				text,
				width: lineW,
				start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
				end: { segmentIndex: lineEndSegment, graphemeIndex: lineEndGrapheme },
			};
		}
		lineW = projectedWidth;
		lineEndSegment = i + 1;
		lineEndGrapheme = 0;
		if (canBreakAfter(seg.kind)) {
			recordPending(i + 1, 0, seg.kind === "space" ? lineW - w : lineW, seg.kind);
		}
	}
	if (!hasContent) return null;
	const endsAtSoftHyphen =
		lineEndSegment > 0 && segments[lineEndSegment - 1]?.kind === "soft-hyphen";
	const text = buildLineText(
		segments,
		startSegment,
		startGrapheme,
		lineEndSegment,
		lineEndGrapheme,
		endsAtSoftHyphen,
		segmentAdapter,
	);
	return {
		text,
		width: lineW + (endsAtSoftHyphen ? hyphenWidth : 0),
		start: { segmentIndex: startSegment, graphemeIndex: startGrapheme },
		end: { segmentIndex: lineEndSegment, graphemeIndex: lineEndGrapheme },
	};
}

/** Subtract obstacle intervals from a horizontal text band. */
export function carveTextLineSlots(
	base: Interval,
	blocked: readonly Interval[],
	minSlotWidth = 0,
): Interval[] {
	let slots: Interval[] = [base];
	for (const block of blocked) {
		const next: Interval[] = [];
		for (const slot of slots) {
			if (block.right <= slot.left || block.left >= slot.right) {
				next.push(slot);
				continue;
			}
			if (block.left > slot.left) next.push({ left: slot.left, right: block.left });
			if (block.right < slot.right) next.push({ left: block.right, right: slot.right });
		}
		slots = next;
	}
	if (minSlotWidth > 0) return slots.filter((slot) => slot.right - slot.left >= minSlotWidth);
	return slots;
}

/** Compute per-grapheme boxes for already-broken lines. */
export function computeCharPositions(
	lineBreaks: LineBreaksResult,
	segments: readonly PreparedSegment[],
	lineHeight: number,
	segmentAdapter?: SegmentAdapter,
): readonly CharPosition[] {
	const positions: CharPosition[] = [];
	const segAdapter = segmentAdapter ?? getDefaultSegmentAdapter();
	for (let lineIdx = 0; lineIdx < lineBreaks.lines.length; lineIdx += 1) {
		const line = lineBreaks.lines[lineIdx];
		const y = lineIdx * lineHeight;
		let x = 0;
		for (let si = line.startSegment; si < segments.length; si += 1) {
			const seg = segments[si];
			if (seg.kind === "soft-hyphen" || seg.kind === "hard-break") {
				if (si >= line.endSegment && line.endGrapheme === 0) break;
				continue;
			}
			const graphemes = [...segAdapter.segmentGraphemes(seg.text)].map((g) => g.segment);
			if (graphemes.length === 0) continue;
			const startGrapheme = si === line.startSegment ? line.startGrapheme : 0;
			let endGrapheme: number;
			if (si < line.endSegment) {
				endGrapheme = graphemes.length;
			} else if (si === line.endSegment && line.endGrapheme > 0) {
				endGrapheme = line.endGrapheme;
			} else {
				break;
			}
			for (let g = startGrapheme; g < endGrapheme; g += 1) {
				const width = seg.graphemeWidths ? seg.graphemeWidths[g] : seg.width / graphemes.length;
				positions.push({ x, y, width, height: lineHeight, line: lineIdx });
				x += width;
			}
		}
	}
	return positions;
}

function nonNegativeFinite(value: number, fallback: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finiteNumber(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

function emitLayoutError(ctx: Ctx, error: unknown, fallback: string): void {
	ctx.down([["ERROR", errorPayload(error, fallback)]]);
}

function positiveFinite(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampDimension(value: number | undefined): number {
	return nonNegativeFinite(value ?? 0, 0);
}

function fitSize(size: Size, maxWidth: number): Size {
	const width = nonNegativeFinite(size.width, 0);
	const height = nonNegativeFinite(size.height, 0);
	if (width === 0 || maxWidth <= 0 || width <= maxWidth) return { width, height };
	const scale = maxWidth / width;
	return { width: maxWidth, height: height * scale };
}

function blockMaxWidth(blockMaxWidth: number | undefined, maxWidth: number): number {
	const own = blockMaxWidth === undefined ? maxWidth : nonNegativeFinite(blockMaxWidth, maxWidth);
	if (maxWidth <= 0) return own;
	if (own <= 0) return maxWidth;
	return Math.min(own, maxWidth);
}

function resolveTextAdapter(opts: MeasureBlockOptions): MeasurementAdapter {
	const adapter = opts.adapters?.text ?? opts.adapter;
	if (!adapter) throw new Error("Text blocks require a MeasurementAdapter");
	return adapter;
}

/** Measure one text/image/SVG block using only explicit or injected synchronous adapters. */
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

/** Measure a block list while sharing a measurement cache across text blocks. */
export function measureBlocks(
	blocks: readonly ContentBlock[],
	opts: MeasureBlockOptions,
): readonly MeasuredBlock[] {
	const cache = opts.cache ?? new Map<string, Map<string, number>>();
	return blocks.map((block) => measureBlock(block, { ...opts, cache }));
}

/** Stack measured blocks vertically with margins and a fixed gap. */
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

/** Compute the bottom edge of a positioned block flow. */
export function computeTotalHeight(blocks: readonly PositionedBlock[]): number {
	if (blocks.length === 0) return 0;
	let bottom = 0;
	for (const block of blocks) {
		bottom = Math.max(bottom, block.y + block.height + block.marginBottom);
	}
	return bottom;
}

function columnGeometry(
	container: FlowContainer,
	columns: FlowColumns | undefined,
): {
	readonly paddingX: number;
	readonly paddingY: number;
	readonly count: number;
	readonly gap: number;
	readonly width: number;
	readonly height: number;
	readonly columnWidth: number;
} {
	const paddingX = nonNegativeFinite(container.paddingX ?? 0, 0);
	const paddingY = nonNegativeFinite(container.paddingY ?? 0, 0);
	const count = Math.max(1, Math.floor(nonNegativeFinite(columns?.count ?? 1, 1)));
	const gap = nonNegativeFinite(columns?.gap ?? 0, 0);
	const width = nonNegativeFinite(container.width, 0);
	const height = nonNegativeFinite(container.height, 0);
	const innerWidth = Math.max(0, width - paddingX * 2 - gap * (count - 1));
	const columnWidth = count > 0 ? innerWidth / count : 0;
	return { paddingX, paddingY, count, gap, width, height, columnWidth };
}

function sanitizeFlowContainer(container: FlowContainer): FlowContainer {
	return {
		width: nonNegativeFinite(container.width, 0),
		height: nonNegativeFinite(container.height, 0),
		paddingX:
			container.paddingX === undefined ? undefined : nonNegativeFinite(container.paddingX, 0),
		paddingY:
			container.paddingY === undefined ? undefined : nonNegativeFinite(container.paddingY, 0),
	};
}

function sanitizeFlowColumns(columns: FlowColumns): FlowColumns {
	return {
		count:
			columns.count === undefined
				? undefined
				: Math.max(1, Math.floor(nonNegativeFinite(columns.count, 1))),
		gap: columns.gap === undefined ? undefined : nonNegativeFinite(columns.gap, 0),
	};
}

function sanitizeObstacles(obstacles: readonly Obstacle[]): readonly Obstacle[] {
	return obstacles.map((obstacle) => {
		if (obstacle.kind === "circle") {
			return {
				kind: obstacle.kind,
				cx: finiteNumber(obstacle.cx, 0),
				cy: finiteNumber(obstacle.cy, 0),
				r: nonNegativeFinite(obstacle.r, 0),
			};
		}
		return {
			kind: obstacle.kind,
			x: finiteNumber(obstacle.x, 0),
			y: finiteNumber(obstacle.y, 0),
			width: nonNegativeFinite(obstacle.width, 0),
			height: nonNegativeFinite(obstacle.height, 0),
		};
	});
}

/** Intersect a circle obstacle with a horizontal line band. */
export function circleIntervalForBand(
	obstacle: CircleObstacle,
	bandTop: number,
	bandBottom: number,
): Interval | null {
	const radius = nonNegativeFinite(obstacle.r, 0);
	const centerY = obstacle.cy;
	const nearestY = Math.max(bandTop, Math.min(centerY, bandBottom));
	const dy = nearestY - centerY;
	if (Math.abs(dy) > radius) return null;
	const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
	return { left: obstacle.cx - dx, right: obstacle.cx + dx };
}

/** Intersect a rectangle obstacle with a horizontal line band. */
export function rectIntervalForBand(
	obstacle: RectObstacle,
	bandTop: number,
	bandBottom: number,
): Interval | null {
	const left = obstacle.x;
	const right = obstacle.x + nonNegativeFinite(obstacle.width, 0);
	const top = obstacle.y;
	const bottom = obstacle.y + nonNegativeFinite(obstacle.height, 0);
	if (bottom <= bandTop || top >= bandBottom || right <= left) return null;
	return { left, right };
}

function blockedIntervalsForBand(
	obstacles: readonly Obstacle[],
	bandTop: number,
	bandBottom: number,
): Interval[] {
	const intervals: Interval[] = [];
	for (const obstacle of obstacles) {
		const interval =
			obstacle.kind === "circle"
				? circleIntervalForBand(obstacle, bandTop, bandBottom)
				: rectIntervalForBand(obstacle, bandTop, bandBottom);
		if (interval) intervals.push(interval);
	}
	return intervals.sort((a, b) => a.left - b.left);
}

/** Flow prepared text through columns and carved obstacle slots. */
export function computeFlowLines(
	segments: readonly PreparedSegment[],
	opts: ComputeFlowLinesOptions,
): FlowLinesResult {
	const geometry = columnGeometry(opts.container, opts.columns);
	const lineHeight = positiveFinite(opts.lineHeight, 20);
	const minSlotWidth = nonNegativeFinite(opts.minSlotWidth ?? 0, 0);
	const obstacles = opts.obstacles ?? [];
	const segmentAdapter = opts.segmentAdapter ?? getDefaultSegmentAdapter();
	const lines: PositionedLine[] = [];
	let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
	const contentBottom = Math.max(geometry.paddingY, geometry.height - geometry.paddingY);
	for (let columnIndex = 0; columnIndex < geometry.count; columnIndex += 1) {
		const columnLeft = geometry.paddingX + columnIndex * (geometry.columnWidth + geometry.gap);
		const columnRight = columnLeft + geometry.columnWidth;
		for (
			let y = geometry.paddingY;
			y + lineHeight <= contentBottom + 1e-3 && cursor.segmentIndex < segments.length;
			y += lineHeight
		) {
			const blocked = blockedIntervalsForBand(obstacles, y, y + lineHeight);
			const slots = carveTextLineSlots(
				{ left: columnLeft, right: columnRight },
				blocked,
				Math.max(minSlotWidth, 1e-6),
			);
			for (const slot of slots) {
				if (cursor.segmentIndex >= segments.length) break;
				const slotWidth = slot.right - slot.left;
				const next = layoutNextLine(segments, cursor, slotWidth, {
					hyphenWidth: opts.hyphenWidth,
					segmentAdapter,
				});
				if (next === null) {
					cursor = { segmentIndex: segments.length, graphemeIndex: 0 };
					break;
				}
				if (
					next.end.segmentIndex === cursor.segmentIndex &&
					next.end.graphemeIndex === cursor.graphemeIndex
				) {
					break;
				}
				cursor = next.end;
				if (next.text.length === 0 && next.width === 0) break;
				lines.push({
					text: next.text,
					width: next.width,
					startSegment: next.start.segmentIndex,
					startGrapheme: next.start.graphemeIndex,
					endSegment: next.end.segmentIndex,
					endGrapheme: next.end.graphemeIndex,
					x: slot.left,
					y,
					slotWidth,
					columnIndex,
				});
			}
		}
	}
	return {
		lines,
		cursor,
		done: cursor.segmentIndex >= segments.length,
	};
}

/**
 * Create a graph-visible single-column text layout bundle.
 *
 * D181: this adds ordinary state/output nodes only; it does not add protocol behavior,
 * hidden subscriptions, GraphSpec ownership, storage, or platform globals.
 */
export function reactiveLayout(opts: ReactiveLayoutOptions): ReactiveLayoutBundle {
	const { measurements, segmentAdapter: segmentAdapterOpt, name = "reactive-layout" } = opts;
	const targetId = opts.targetId ?? "text";
	const segAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = opts.graph;
	const lineHeightInput = inputNode(
		g,
		opts.lineHeight instanceof Node
			? opts.lineHeight
			: nonNegativeFinite(opts.lineHeight ?? 20, 20),
		nonNegativeFinite(20, 20),
		scopedName(name, "line-height"),
	);
	const maxWidthInput = inputNode(
		g,
		opts.maxWidth instanceof Node ? opts.maxWidth : nonNegativeFinite(opts.maxWidth ?? 800, 800),
		nonNegativeFinite(800, 800),
		scopedName(name, "max-width"),
	);
	const segments = g.node<readonly PreparedSegment[]>(
		[measurements],
		(ctx: Ctx) => {
			try {
				const measured = latestMeasurementValue<TextSegmentsMeasurement>(
					depLatest(ctx, 0) as Measurements,
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
					depLatest(ctx, 2) as Measurements,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
				);
				const computed = computeLineBreaks(
					depLatest(ctx, 0) as readonly PreparedSegment[],
					nonNegativeFinite(depLatest(ctx, 1) as number, 0),
					{ hyphenWidth: measured?.hyphenWidth, segmentAdapter: segAdapter },
				);
				ctx.down([["DATA", computed]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout line breaks failed");
			}
		},
		{ name: scopedName(name, "line-breaks") },
	);
	const height = g.node<number>(
		[lineBreaks, lineHeightInput.node],
		(ctx: Ctx) => {
			try {
				const lines = depLatest(ctx, 0) as LineBreaksResult;
				const lineHeight = nonNegativeFinite(depLatest(ctx, 1) as number, 0);
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
					depLatest(ctx, 0) as LineBreaksResult,
					depLatest(ctx, 1) as readonly PreparedSegment[],
					nonNegativeFinite(depLatest(ctx, 2) as number, 0),
					segAdapter,
				);
				ctx.down([["DATA", positions]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout char positions failed");
			}
		},
		{ name: scopedName(name, "char-positions") },
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
 * Image/SVG sizing is explicit or injected; no async image loading or DOM SVG parsing occurs.
 */
export function reactiveBlockLayout(opts: ReactiveBlockLayoutOptions): ReactiveBlockLayoutBundle {
	const { measurements, name = "reactive-block-layout" } = opts;
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
					depLatest(ctx, 0) as Measurements,
					targetId,
					BLOCKS_MEASUREMENT_KIND,
				);
				ctx.down([["DATA", measured?.blocks ?? []]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout measured-blocks failed");
			}
		},
		{ name: scopedName(name, "measured-blocks") },
	);
	const blockFlow = g.node<readonly PositionedBlock[]>(
		[measuredBlocks, gapInput.node],
		(ctx: Ctx) => {
			try {
				const positioned = computeBlockFlow(
					depLatest(ctx, 0) as readonly MeasuredBlock[],
					nonNegativeFinite(depLatest(ctx, 1) as number, 0),
				);
				ctx.down([["DATA", positioned]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout flow failed");
			}
		},
		{ name: scopedName(name, "block-flow") },
	);
	const totalHeight = g.node<number>(
		[blockFlow],
		(ctx: Ctx) => {
			try {
				ctx.down([["DATA", computeTotalHeight(depLatest(ctx, 0) as readonly PositionedBlock[])]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout total height failed");
			}
		},
		{ name: scopedName(name, "total-height") },
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

/** Create a graph-visible multi-column flow layout bundle with rectangle/circle obstacles. */
export function reactiveFlowLayout(opts: ReactiveFlowLayoutOptions): ReactiveFlowLayoutBundle {
	const { measurements, segmentAdapter: segmentAdapterOpt, name = "reactive-flow-layout" } = opts;
	const targetId = opts.targetId ?? "text";
	const segAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = opts.graph;
	const lineHeightInput = inputNode(
		g,
		opts.lineHeight instanceof Node
			? opts.lineHeight
			: nonNegativeFinite(opts.lineHeight ?? 20, 20),
		nonNegativeFinite(20, 20),
		scopedName(name, "line-height"),
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
					depLatest(ctx, 0) as Measurements,
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
					depLatest(ctx, 5) as Measurements,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
				);
				const computed = computeFlowLines(depLatest(ctx, 0) as readonly PreparedSegment[], {
					lineHeight: nonNegativeFinite(depLatest(ctx, 1) as number, 0),
					container: sanitizeFlowContainer(depLatest(ctx, 2) as FlowContainer),
					columns: sanitizeFlowColumns(depLatest(ctx, 3) as FlowColumns),
					obstacles: sanitizeObstacles(depLatest(ctx, 4) as readonly Obstacle[]),
					minSlotWidth: nonNegativeFinite(opts.minSlotWidth ?? 0, 0),
					hyphenWidth: measured?.hyphenWidth,
					segmentAdapter: segAdapter,
				});
				ctx.down([["DATA", computed]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveFlowLayout flow lines failed");
			}
		},
		{ name: scopedName(name, "flow-lines") },
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

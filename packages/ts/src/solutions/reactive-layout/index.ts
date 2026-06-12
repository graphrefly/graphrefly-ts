import { type Ctx, depLatest } from "../../ctx/types.js";
import { type Graph, graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
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

/**
 * Graph-visible bundle returned by `reactiveLayout`.
 *
 * The setters are state-node sugar over real graph inputs; the output nodes are ordinary
 * inspectable nodes visible through `graph.describe()`.
 */
export interface ReactiveLayoutBundle {
	readonly graph: Graph;
	readonly input: {
		readonly text: Node<string>;
		readonly font: Node<string>;
		readonly lineHeight: Node<number>;
		readonly maxWidth: Node<number>;
	};
	setText(text: string): void;
	setFont(font: string): void;
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
	readonly segmentAdapter?: SegmentAdapter;
}

/** Cache accounting object callers can pass into `analyzeAndMeasure`. */
export interface SegmentMeasureStats {
	hits: number;
	misses: number;
}

/** Options for the single-column reactive text layout bundle. */
export interface ReactiveLayoutOptions {
	readonly adapter: MeasurementAdapter;
	readonly segmentAdapter?: SegmentAdapter;
	readonly name?: string;
	readonly text?: string;
	readonly font?: string;
	readonly lineHeight?: number;
	readonly maxWidth?: number;
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
	readonly segmentAdapter?: SegmentAdapter;
}

/** Options for the graph-visible block layout bundle. */
export interface ReactiveBlockLayoutOptions {
	readonly adapter?: MeasurementAdapter;
	readonly adapters?: BlockAdapters;
	readonly segmentAdapter?: SegmentAdapter;
	readonly name?: string;
	readonly blocks?: readonly ContentBlock[];
	readonly font?: string;
	readonly lineHeight?: number;
	readonly maxWidth?: number;
	readonly gap?: number;
}

/** Graph-visible vertical block layout bundle. */
export interface ReactiveBlockLayoutBundle {
	readonly graph: Graph;
	readonly input: {
		readonly blocks: Node<readonly ContentBlock[]>;
		readonly maxWidth: Node<number>;
		readonly gap: Node<number>;
	};
	setBlocks(blocks: readonly ContentBlock[]): void;
	setMaxWidth(maxWidth: number): void;
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
	readonly adapter?: MeasurementAdapter;
	readonly font?: string;
	readonly cache?: Map<string, Map<string, number>>;
	readonly segmentAdapter?: SegmentAdapter;
}

/** Options for the graph-visible flow layout bundle. */
export interface ReactiveFlowLayoutOptions {
	readonly adapter: MeasurementAdapter;
	readonly segmentAdapter?: SegmentAdapter;
	readonly name?: string;
	readonly text?: string;
	readonly font?: string;
	readonly lineHeight?: number;
	readonly container?: FlowContainer;
	readonly columns?: FlowColumns;
	readonly obstacles?: readonly Obstacle[];
	readonly minSlotWidth?: number;
}

/** Graph-visible multi-column flow layout bundle. */
export interface ReactiveFlowLayoutBundle {
	readonly graph: Graph;
	readonly input: {
		readonly text: Node<string>;
		readonly font: Node<string>;
		readonly lineHeight: Node<number>;
		readonly container: Node<FlowContainer>;
		readonly columns: Node<FlowColumns>;
		readonly obstacles: Node<readonly Obstacle[]>;
	};
	setText(text: string): void;
	setFont(font: string): void;
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
	private readonly sizes: ReadonlyMap<string, Size>;

	constructor(sizes: ReadonlyMap<string, Size> | Record<string, Size>) {
		this.sizes = sizes instanceof Map ? sizes : new Map(Object.entries(sizes));
	}

	measureImage(src: string): Size {
		const size = this.sizes.get(src);
		if (!size) throw new Error(`No image size registered for ${JSON.stringify(src)}`);
		return {
			width: nonNegativeFinite(size.width, 0),
			height: nonNegativeFinite(size.height, 0),
		};
	}
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
	adapter: MeasurementAdapter,
	font: string,
	cache: Map<string, Map<string, number>>,
	segmentAdapter?: SegmentAdapter,
): LineBreaksResult {
	if (segments.length === 0) return { lines: [], lineCount: 0 };
	const segAdapter = segmentAdapter ?? getDefaultSegmentAdapter();
	const lines: LayoutLine[] = [];
	let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
	while (cursor.segmentIndex < segments.length) {
		const next = layoutNextLine(segments, cursor, maxWidth, {
			adapter,
			font,
			cache,
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
		const lineBreaks = computeLineBreaks(
			segments,
			width,
			adapter,
			font,
			cache,
			opts.segmentAdapter,
		);
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
					adapter: opts.adapter,
					font: opts.font,
					cache: opts.cache,
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
	const { adapter, segmentAdapter: segmentAdapterOpt, name = "reactive-layout" } = opts;
	const segAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = graph({ name });
	const measureCache = new Map<string, Map<string, number>>();
	const textNode = g.state(opts.text ?? "", { name: "text" });
	const fontNode = g.state(opts.font ?? "16px sans-serif", { name: "font" });
	const lineHeightNode = g.state(nonNegativeFinite(opts.lineHeight ?? 20, 20), {
		name: "line-height",
	});
	const maxWidthNode = g.state(nonNegativeFinite(opts.maxWidth ?? 800, 800), {
		name: "max-width",
	});
	const segments = g.node<readonly PreparedSegment[]>(
		[textNode, fontNode],
		(ctx: Ctx) => {
			const flush = () => {
				measureCache.clear();
				adapter.clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			try {
				const text = depLatest(ctx, 0) as string;
				const font = depLatest(ctx, 1) as string;
				const measured = analyzeAndMeasure(
					text,
					font,
					adapter,
					measureCache,
					undefined,
					segAdapter,
				);
				ctx.down([["DATA", measured]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout segments failed");
			}
		},
		{ name: "segments" },
	);
	const lineBreaks = g.node<LineBreaksResult>(
		[segments, maxWidthNode, fontNode],
		(ctx: Ctx) => {
			try {
				const computed = computeLineBreaks(
					depLatest(ctx, 0) as readonly PreparedSegment[],
					depLatest(ctx, 1) as number,
					adapter,
					depLatest(ctx, 2) as string,
					measureCache,
					segAdapter,
				);
				ctx.down([["DATA", computed]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout line breaks failed");
			}
		},
		{ name: "line-breaks" },
	);
	const height = g.node<number>(
		[lineBreaks, lineHeightNode],
		(ctx: Ctx) => {
			try {
				const lines = depLatest(ctx, 0) as LineBreaksResult;
				const lineHeight = depLatest(ctx, 1) as number;
				ctx.down([["DATA", lines.lineCount * lineHeight]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout height failed");
			}
		},
		{ name: "height" },
	);
	const charPositions = g.node<readonly CharPosition[]>(
		[lineBreaks, segments, lineHeightNode],
		(ctx: Ctx) => {
			try {
				const positions = computeCharPositions(
					depLatest(ctx, 0) as LineBreaksResult,
					depLatest(ctx, 1) as readonly PreparedSegment[],
					depLatest(ctx, 2) as number,
					segAdapter,
				);
				ctx.down([["DATA", positions]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveLayout char positions failed");
			}
		},
		{ name: "char-positions" },
	);
	return {
		graph: g,
		input: {
			text: textNode,
			font: fontNode,
			lineHeight: lineHeightNode,
			maxWidth: maxWidthNode,
		},
		setText(text: string): void {
			textNode.set(text);
		},
		setFont(font: string): void {
			fontNode.set(font);
		},
		setLineHeight(lineHeight: number): void {
			lineHeightNode.set(nonNegativeFinite(lineHeight, 0));
		},
		setMaxWidth(maxWidth: number): void {
			maxWidthNode.set(nonNegativeFinite(maxWidth, 0));
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
export function reactiveBlockLayout(
	opts: ReactiveBlockLayoutOptions = {},
): ReactiveBlockLayoutBundle {
	const { segmentAdapter: segmentAdapterOpt, name = "reactive-block-layout" } = opts;
	const segAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = graph({ name });
	const measureCache = new Map<string, Map<string, number>>();
	const blocksNode = g.state(opts.blocks ?? [], { name: "blocks" });
	const maxWidthNode = g.state(nonNegativeFinite(opts.maxWidth ?? 800, 800), {
		name: "max-width",
	});
	const gapNode = g.state(nonNegativeFinite(opts.gap ?? 0, 0), { name: "gap" });
	const measuredBlocks = g.node<readonly MeasuredBlock[]>(
		[blocksNode, maxWidthNode],
		(ctx: Ctx) => {
			const flush = () => {
				measureCache.clear();
				opts.adapter?.clearCache?.();
				opts.adapters?.text?.clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			try {
				const blocks = depLatest(ctx, 0) as readonly ContentBlock[];
				const maxWidth = depLatest(ctx, 1) as number;
				const measured = measureBlocks(blocks, {
					adapter: opts.adapter,
					adapters: opts.adapters,
					font: opts.font,
					lineHeight: opts.lineHeight,
					maxWidth,
					cache: measureCache,
					segmentAdapter: segAdapter,
				});
				ctx.down([["DATA", measured]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout measurement failed");
			}
		},
		{ name: "measured-blocks" },
	);
	const blockFlow = g.node<readonly PositionedBlock[]>(
		[measuredBlocks, gapNode],
		(ctx: Ctx) => {
			try {
				const positioned = computeBlockFlow(
					depLatest(ctx, 0) as readonly MeasuredBlock[],
					depLatest(ctx, 1) as number,
				);
				ctx.down([["DATA", positioned]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveBlockLayout flow failed");
			}
		},
		{ name: "block-flow" },
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
		{ name: "total-height" },
	);
	return {
		graph: g,
		input: {
			blocks: blocksNode,
			maxWidth: maxWidthNode,
			gap: gapNode,
		},
		setBlocks(blocks: readonly ContentBlock[]): void {
			blocksNode.set(blocks);
		},
		setMaxWidth(maxWidth: number): void {
			maxWidthNode.set(nonNegativeFinite(maxWidth, 0));
		},
		setGap(gap: number): void {
			gapNode.set(nonNegativeFinite(gap, 0));
		},
		measuredBlocks,
		blockFlow,
		totalHeight,
	};
}

/** Create a graph-visible multi-column flow layout bundle with rectangle/circle obstacles. */
export function reactiveFlowLayout(opts: ReactiveFlowLayoutOptions): ReactiveFlowLayoutBundle {
	const { adapter, segmentAdapter: segmentAdapterOpt, name = "reactive-flow-layout" } = opts;
	const segAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = graph({ name });
	const measureCache = new Map<string, Map<string, number>>();
	const textNode = g.state(opts.text ?? "", { name: "text" });
	const fontNode = g.state(opts.font ?? "16px sans-serif", { name: "font" });
	const lineHeightNode = g.state(nonNegativeFinite(opts.lineHeight ?? 20, 20), {
		name: "line-height",
	});
	const containerNode = g.state(opts.container ?? { width: 800, height: 600 }, {
		name: "container",
	});
	const columnsNode = g.state(opts.columns ?? { count: 1, gap: 0 }, { name: "columns" });
	const obstaclesNode = g.state(opts.obstacles ?? [], { name: "obstacles" });
	const segments = g.node<readonly PreparedSegment[]>(
		[textNode, fontNode],
		(ctx: Ctx) => {
			const flush = () => {
				measureCache.clear();
				adapter.clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			try {
				const text = depLatest(ctx, 0) as string;
				const font = depLatest(ctx, 1) as string;
				const measured = analyzeAndMeasure(
					text,
					font,
					adapter,
					measureCache,
					undefined,
					segAdapter,
				);
				ctx.down([["DATA", measured]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveFlowLayout segments failed");
			}
		},
		{ name: "segments" },
	);
	const flowLines = g.node<FlowLinesResult>(
		[segments, lineHeightNode, containerNode, columnsNode, obstaclesNode, fontNode],
		(ctx: Ctx) => {
			try {
				const computed = computeFlowLines(depLatest(ctx, 0) as readonly PreparedSegment[], {
					lineHeight: depLatest(ctx, 1) as number,
					container: depLatest(ctx, 2) as FlowContainer,
					columns: depLatest(ctx, 3) as FlowColumns,
					obstacles: depLatest(ctx, 4) as readonly Obstacle[],
					font: depLatest(ctx, 5) as string,
					minSlotWidth: opts.minSlotWidth,
					adapter,
					cache: measureCache,
					segmentAdapter: segAdapter,
				});
				ctx.down([["DATA", computed]]);
			} catch (error) {
				emitLayoutError(ctx, error, "reactiveFlowLayout flow lines failed");
			}
		},
		{ name: "flow-lines" },
	);
	return {
		graph: g,
		input: {
			text: textNode,
			font: fontNode,
			lineHeight: lineHeightNode,
			container: containerNode,
			columns: columnsNode,
			obstacles: obstaclesNode,
		},
		setText(text: string): void {
			textNode.set(text);
		},
		setFont(font: string): void {
			fontNode.set(font);
		},
		setLineHeight(lineHeight: number): void {
			lineHeightNode.set(nonNegativeFinite(lineHeight, 0));
		},
		setContainer(container: FlowContainer): void {
			containerNode.set(container);
		},
		setColumns(columns: FlowColumns): void {
			columnsNode.set(columns);
		},
		setObstacles(obstacles: readonly Obstacle[]): void {
			obstaclesNode.set(obstacles);
		},
		segments,
		flowLines,
	};
}

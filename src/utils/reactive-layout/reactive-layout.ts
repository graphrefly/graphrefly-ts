/**
 * Reactive text layout engine (roadmap §7.1 — Pretext parity).
 *
 * Pure-arithmetic text measurement and line breaking without DOM thrashing.
 * Inspired by [Pretext](https://github.com/chenglou/pretext), rebuilt as a
 * GraphReFly graph — inspectable via `describe()`, snapshotable, debuggable.
 *
 * Two-tier DX:
 * - `reactiveLayout({ adapter, text?, font?, lineHeight?, maxWidth?, name? })` — convenience factory
 * - `MeasurementAdapter` — pluggable backends (`measureSegment`; optional `clearCache`)
 */
import { depLatest, Graph, type Node } from "@graphrefly/ts";
import { getDefaultSegmentAdapter } from "./measurement-adapters.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pluggable measurement backend. */
export interface MeasurementAdapter {
	measureSegment(text: string, font: string): { width: number };
	/** Optional; adapters may omit for read-only / stateless measurement. */
	clearCache?(): void;
}

/**
 * A single segmented piece — the structurally-narrowed common shape across
 * `Intl.Segmenter`'s `Intl.SegmentData` and host-provided polyfills.
 *
 * Drops `input` (redundant — the caller already has the text) and narrows
 * `isWordLike` to "may be missing" so grapheme-granularity callers ignore it
 * cleanly.
 */
export type SegmentInfo = {
	/** The segmented substring. */
	segment: string;
	/** Code-unit offset of `segment` within the input. */
	index: number;
	/** True if the word-granularity segment looks like a word (letters / kana / etc.). Always undefined for grapheme granularity. */
	isWordLike?: boolean;
};

/**
 * Pluggable text-segmentation backend (separate from {@link MeasurementAdapter}
 * because measurement and segmentation are different host concerns —
 * Skia/Canvas measure widths, ICU segments graphemes/words).
 *
 * **Why this exists (DS-2026-05-20 — `optimizations.md` 🟠 (d)).**
 * `reactive-layout`'s default backend uses `new Intl.Segmenter(...)` for word /
 * grapheme iteration. Hermes (iOS 26.5 / RN 0.83) ships **without**
 * `Intl.Segmenter` — `typeof Intl.Segmenter === "undefined"` — and the
 * constructor throws `Cannot read property 'prototype' of undefined`. This
 * interface lets RN/Hermes consumers inject their own segmenter (typically a
 * polyfill wrapper) so the substrate never touches the missing global.
 *
 * **Contract:** sync, pure, idempotent. `segmentWords` must mirror
 * `Intl.Segmenter(undefined, { granularity: "word" }).segment(text)`'s shape
 * (an iterable of `{ segment, index, isWordLike }`); `segmentGraphemes`
 * mirrors `{ granularity: "grapheme" }`. The reference implementation is
 * {@link IntlSegmentAdapter}.
 *
 * **Polyfill recipe (RN/Hermes consumer userland — NOT shipped here per the
 * `bigintJsonCodecFor` userland-binding precedent):**
 *
 * ```ts
 * // Userland — at app entry, before any reactive-layout import:
 * import "intl-segmenter-polyfill/dist/polyfill"; // or @formatjs/intl-segmenter
 * // Then the substrate's default IntlSegmentAdapter works:
 * import { reactiveLayout } from "@graphrefly/graphrefly/utils/reactive-layout";
 * ```
 *
 * Or, without polyfilling the global (preferred — keeps ICU bytes scoped):
 *
 * ```ts
 * // Userland — wrap any segmenter implementation:
 * import { createIntlSegmenterPolyfill } from "intl-segmenter-polyfill";
 * import type { SegmentAdapter, SegmentInfo } from "@graphrefly/graphrefly/utils/reactive-layout";
 *
 * const wordSeg = await createIntlSegmenterPolyfill({ granularity: "word" });
 * const graphemeSeg = await createIntlSegmenterPolyfill({ granularity: "grapheme" });
 * const segmentAdapter: SegmentAdapter = {
 *   segmentWords: (text) => wordSeg.segment(text) as Iterable<SegmentInfo>,
 *   segmentGraphemes: (text) => graphemeSeg.segment(text) as Iterable<SegmentInfo>,
 * };
 * reactiveLayout({ adapter, segmentAdapter, ... });
 * ```
 */
export interface SegmentAdapter {
	/** Word-granularity segmentation — yields `{ segment, index, isWordLike }`. */
	segmentWords(text: string): Iterable<SegmentInfo>;
	/** Grapheme-granularity segmentation — yields `{ segment, index }`. `isWordLike` is unused / undefined. */
	segmentGraphemes(text: string): Iterable<SegmentInfo>;
}

/** Mutable counters for `analyzeAndMeasure` cache hit ratio (hits / (hits + misses)). */
export type SegmentMeasureStats = { hits: number; misses: number };

/** Break kind for each segment (ported from Pretext analysis.ts). */
export type SegmentBreakKind = "text" | "space" | "zero-width-break" | "soft-hyphen" | "hard-break";

/** A measured text segment ready for line breaking. */
export type PreparedSegment = {
	text: string;
	width: number;
	kind: SegmentBreakKind;
	/** Grapheme widths for overflow-wrap: break-word (null if single grapheme). */
	graphemeWidths: number[] | null;
};

/** A laid-out line with start/end cursors. */
export type LayoutLine = {
	text: string;
	width: number;
	startSegment: number;
	startGrapheme: number;
	endSegment: number;
	endGrapheme: number;
};

/** Per-character position for hit testing. */
export type CharPosition = {
	x: number;
	y: number;
	width: number;
	height: number;
	line: number;
};

/** Full layout result from the line-breaks derived node. */
export type LineBreaksResult = {
	lines: LayoutLine[];
	lineCount: number;
};

/**
 * A position within `PreparedSegment[]` — segment + grapheme offset.
 * `graphemeIndex: 0` at segment boundaries.
 *
 * Used by {@link layoutNextLine} for cursor-based line walking; needed when
 * lines have varying widths (multi-column flow, text wrapping around obstacles).
 */
export type LayoutCursor = {
	segmentIndex: number;
	graphemeIndex: number;
};

/** A horizontal span `[left, right]` in pixels — used by flow-layout slot carving. */
export type Interval = { left: number; right: number };

/** Result of a single `layoutNextLine` call. */
export type LayoutNextLineResult = {
	text: string;
	width: number;
	start: LayoutCursor;
	end: LayoutCursor;
};

/** Optional context for `layoutNextLine` — enables soft-hyphen visible-hyphen rendering. */
export type LayoutNextLineContext = {
	adapter?: MeasurementAdapter;
	font?: string;
	cache?: Map<string, Map<string, number>>;
	/**
	 * Optional {@link SegmentAdapter} for grapheme slicing during partial-segment
	 * line builds. Defaults to {@link IntlSegmentAdapter} (lazy module shared);
	 * Hermes / RN consumers wire their own to avoid the missing-`Intl.Segmenter`
	 * runtime throw — see {@link SegmentAdapter} JSDoc.
	 */
	segmentAdapter?: SegmentAdapter;
};

/** Result of the reactive layout graph's describe-accessible state. */
export type ReactiveLayoutBundle = {
	graph: Graph;
	/** Set input text. */
	setText: (text: string) => void;
	/** Set CSS font string. */
	setFont: (font: string) => void;
	/** Set line height (px). */
	setLineHeight: (lineHeight: number) => void;
	/** Set max width constraint (px). */
	setMaxWidth: (maxWidth: number) => void;
	/** Segments node. */
	segments: Node<PreparedSegment[]>;
	/** Line breaks node. */
	lineBreaks: Node<LineBreaksResult>;
	/** Total height node. */
	height: Node<number>;
	/** Per-character positions node. */
	charPositions: Node<CharPosition[]>;
};

// ---------------------------------------------------------------------------
// Text analysis (ported from Pretext analysis.ts — core subset)
// ---------------------------------------------------------------------------

// CJK detection (Unicode CJK Unified Ideographs + common ranges)
function isCJK(s: string): boolean {
	for (const ch of s) {
		const c = ch.codePointAt(0)!;
		if (
			(c >= 0x4e00 && c <= 0x9fff) || // CJK Unified Ideographs
			(c >= 0x3400 && c <= 0x4dbf) || // CJK Extension A
			(c >= 0x3000 && c <= 0x303f) || // CJK Symbols and Punctuation
			(c >= 0x3040 && c <= 0x309f) || // Hiragana
			(c >= 0x30a0 && c <= 0x30ff) || // Katakana
			(c >= 0xac00 && c <= 0xd7af) || // Hangul
			(c >= 0xff00 && c <= 0xffef) // Fullwidth Forms
		) {
			return true;
		}
	}
	return false;
}

// Kinsoku: characters that cannot start a line (CJK punctuation)
const kinsokuStart = new Set([
	"\uff0c",
	"\uff0e",
	"\uff01",
	"\uff1a",
	"\uff1b",
	"\uff1f",
	"\u3001",
	"\u3002",
	"\u30fb",
	"\uff09",
	"\u3015",
	"\u3009",
	"\u300b",
	"\u300d",
	"\u300f",
	"\u3011",
]);

// Left-sticky punctuation (merges into preceding segment)
const leftStickyPunctuation = new Set([
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
	"\u201d",
	"\u2019",
	"\u00bb",
	"\u203a",
	"\u2026",
]);

/** Normalize collapsible whitespace (CSS white-space: normal). */
function normalizeWhitespace(text: string): string {
	return text.replace(/[\t\n\r\f ]+/g, " ").replace(/^ | $/g, "");
}

/**
 * Segment text using the supplied {@link SegmentAdapter} (word granularity)
 * and classify break kinds. Returns raw segmentation pieces before merging.
 */
function segmentText(
	normalized: string,
	segmentAdapter: SegmentAdapter,
): {
	texts: string[];
	isWordLike: boolean[];
	kinds: SegmentBreakKind[];
}[] {
	const pieces: {
		texts: string[];
		isWordLike: boolean[];
		kinds: SegmentBreakKind[];
	}[] = [];

	for (const s of segmentAdapter.segmentWords(normalized)) {
		const text = s.segment;
		const isWordLike = s.isWordLike ?? false;

		// Split segment by break-relevant characters
		const texts: string[] = [];
		const wordLikes: boolean[] = [];
		const kinds: SegmentBreakKind[] = [];

		let currentText = "";
		let currentKind: SegmentBreakKind | null = null;

		for (const ch of text) {
			let kind: SegmentBreakKind;
			if (ch === " ") kind = "space";
			else if (ch === "\u200b") kind = "zero-width-break";
			else if (ch === "\u00ad") kind = "soft-hyphen";
			else if (ch === "\n") kind = "hard-break";
			else kind = "text";

			if (currentKind !== null && kind === currentKind) {
				currentText += ch;
			} else {
				if (currentKind !== null) {
					texts.push(currentText);
					wordLikes.push(currentKind === "text" && isWordLike);
					kinds.push(currentKind);
				}
				currentText = ch;
				currentKind = kind;
			}
		}

		if (currentKind !== null) {
			texts.push(currentText);
			wordLikes.push(currentKind === "text" && isWordLike);
			kinds.push(currentKind);
		}

		pieces.push({ texts, isWordLike: wordLikes, kinds });
	}
	return pieces;
}

/**
 * Merge segmentation pieces: sticky punctuation, CJK per-grapheme splitting,
 * and produce the final measured segment list.
 */
export function analyzeAndMeasure(
	text: string,
	font: string,
	adapter: MeasurementAdapter,
	cache: Map<string, Map<string, number>>,
	stats?: SegmentMeasureStats,
	segmentAdapter?: SegmentAdapter,
): PreparedSegment[] {
	const normalized = normalizeWhitespace(text);
	if (normalized.length === 0) return [];

	const segAdapter = segmentAdapter ?? getDefaultSegmentAdapter();
	const pieces = segmentText(normalized, segAdapter);

	// Flatten pieces into a single segment list with merging
	const rawTexts: string[] = [];
	const rawKinds: SegmentBreakKind[] = [];
	const rawWordLike: boolean[] = [];

	for (const piece of pieces) {
		for (let i = 0; i < piece.texts.length; i++) {
			rawTexts.push(piece.texts[i]!);
			rawKinds.push(piece.kinds[i]!);
			rawWordLike.push(piece.isWordLike[i]!);
		}
	}

	// Merge: left-sticky punctuation and kinsoku-start into preceding text segment
	const mergedTexts: string[] = [];
	const mergedKinds: SegmentBreakKind[] = [];
	const mergedWordLike: boolean[] = [];

	for (let i = 0; i < rawTexts.length; i++) {
		const t = rawTexts[i]!;
		const k = rawKinds[i]!;
		const wl = rawWordLike[i]!;

		// Merge left-sticky punctuation into preceding text
		if (
			k === "text" &&
			!wl &&
			mergedTexts.length > 0 &&
			mergedKinds[mergedKinds.length - 1] === "text"
		) {
			const isSticky = t.length === 1 && (leftStickyPunctuation.has(t) || kinsokuStart.has(t));
			if (isSticky) {
				mergedTexts[mergedTexts.length - 1] += t;
				continue;
			}
		}

		// Merge hyphen after word into preceding text ("well-known" stays together)
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

	// Get or create font-specific cache
	let fontCache = cache.get(font);
	if (!fontCache) {
		fontCache = new Map<string, number>();
		cache.set(font, fontCache);
	}

	function measureCached(seg: string): number {
		let w = fontCache!.get(seg);
		if (w === undefined) {
			if (stats) stats.misses += 1;
			const raw = adapter.measureSegment(seg, font).width;
			// Coerce adapter misbehavior (NaN / Infinity / negative) to 0 — downstream
			// arithmetic would propagate NaN widths, breaking line-break decisions and
			// rendering. Cached so the coercion happens once per (font, segment).
			w = Number.isFinite(raw) && raw >= 0 ? raw : 0;
			fontCache!.set(seg, w);
		} else if (stats) {
			stats.hits += 1;
		}
		return w;
	}

	// Build final prepared segments, splitting CJK into per-grapheme
	const segments: PreparedSegment[] = [];

	for (let i = 0; i < mergedTexts.length; i++) {
		const t = mergedTexts[i]!;
		const k = mergedKinds[i]!;

		if (k !== "text") {
			// Non-text segments: space, hard-break, soft-hyphen, zero-width-break
			segments.push({
				text: t,
				width: k === "space" ? measureCached(" ") * t.length : 0,
				kind: k,
				graphemeWidths: null,
			});
			continue;
		}

		// CJK text: split into per-grapheme segments for line breaking
		if (isCJK(t)) {
			let unitText = "";
			for (const gs of segAdapter.segmentGraphemes(t)) {
				const grapheme = gs.segment;

				// Kinsoku: line-start-prohibited chars stick to preceding unit
				if (unitText.length > 0 && kinsokuStart.has(grapheme)) {
					unitText += grapheme;
					continue;
				}

				if (unitText.length > 0) {
					const w = measureCached(unitText);
					segments.push({
						text: unitText,
						width: w,
						kind: "text",
						graphemeWidths: null,
					});
				}
				unitText = grapheme;
			}
			if (unitText.length > 0) {
				const w = measureCached(unitText);
				segments.push({
					text: unitText,
					width: w,
					kind: "text",
					graphemeWidths: null,
				});
			}
			continue;
		}

		// Non-CJK text: measure whole segment, pre-compute grapheme widths for break-word
		const w = measureCached(t);
		let graphemeWidths: number[] | null = null;

		if (mergedWordLike[i] && t.length > 1) {
			const gWidths: number[] = [];
			for (const gs of segAdapter.segmentGraphemes(t)) {
				gWidths.push(measureCached(gs.segment));
			}
			if (gWidths.length > 1) {
				graphemeWidths = gWidths;
			}
		}

		segments.push({ text: t, width: w, kind: "text", graphemeWidths });
	}

	return segments;
}

// ---------------------------------------------------------------------------
// Line breaking (greedy, ported from Pretext line-break.ts — core subset)
// ---------------------------------------------------------------------------

/**
 * Greedy line-breaking algorithm.
 *
 * Walks segments left to right, accumulating width. Breaks when a segment would
 * overflow maxWidth. Supports:
 * - Trailing space hang (spaces don't trigger breaks)
 * - overflow-wrap: break-word via grapheme widths
 * - Soft hyphens (break opportunity, adds visible hyphen width)
 * - Hard breaks (forced newline)
 */
export function computeLineBreaks(
	segments: PreparedSegment[],
	maxWidth: number,
	adapter: MeasurementAdapter,
	font: string,
	cache: Map<string, Map<string, number>>,
	segmentAdapter?: SegmentAdapter,
): LineBreaksResult {
	if (segments.length === 0) {
		return { lines: [], lineCount: 0 };
	}
	const segAdapter = segmentAdapter ?? getDefaultSegmentAdapter();

	const lines: LayoutLine[] = [];
	let lineW = 0;
	let hasContent = false;
	let lineStartSeg = 0;
	let lineStartGrapheme = 0;
	let lineEndSeg = 0;
	let lineEndGrapheme = 0;
	let pendingBreakSeg = -1;
	let pendingBreakWidth = 0;

	// Measure hyphen for soft-hyphen support
	let fontCache = cache.get(font);
	if (!fontCache) {
		fontCache = new Map<string, number>();
		cache.set(font, fontCache);
	}
	let hyphenWidth = fontCache.get("-");
	if (hyphenWidth === undefined) {
		hyphenWidth = adapter.measureSegment("-", font).width;
		fontCache.set("-", hyphenWidth);
	}

	function flushLine(endSeg = lineEndSeg, endGrapheme = lineEndGrapheme, width = lineW) {
		// Build line text
		let text = "";
		for (let i = lineStartSeg; i < endSeg; i++) {
			const seg = segments[i]!;
			if (seg.kind === "soft-hyphen" || seg.kind === "hard-break") continue;
			if (i === lineStartSeg && lineStartGrapheme > 0 && seg.graphemeWidths) {
				// Partial segment from grapheme break
				const graphemes = [...segAdapter.segmentGraphemes(seg.text)].map((g) => g.segment);
				text += graphemes.slice(lineStartGrapheme).join("");
			} else {
				text += seg.text;
			}
		}
		// Handle partial end segment
		if (endGrapheme > 0 && endSeg < segments.length) {
			const seg = segments[endSeg]!;
			const graphemes = [...segAdapter.segmentGraphemes(seg.text)].map((g) => g.segment);
			const startG = lineStartSeg === endSeg ? lineStartGrapheme : 0;
			text += graphemes.slice(startG, endGrapheme).join("");
		}
		// Add visible hyphen if line ends at soft-hyphen
		if (
			endSeg > 0 &&
			segments[endSeg - 1]?.kind === "soft-hyphen" &&
			!(lineStartSeg === endSeg && lineStartGrapheme > 0)
		) {
			text += "-";
		}

		lines.push({
			text,
			width,
			startSegment: lineStartSeg,
			startGrapheme: lineStartGrapheme,
			endSegment: endSeg,
			endGrapheme,
		});
		lineW = 0;
		hasContent = false;
		pendingBreakSeg = -1;
		pendingBreakWidth = 0;
	}

	function canBreakAfter(kind: SegmentBreakKind): boolean {
		return kind === "space" || kind === "zero-width-break" || kind === "soft-hyphen";
	}

	function startLine(segIdx: number, graphemeIdx: number, width: number) {
		hasContent = true;
		lineStartSeg = segIdx;
		lineStartGrapheme = graphemeIdx;
		lineEndSeg = segIdx + 1;
		lineEndGrapheme = 0;
		lineW = width;
	}

	function startLineAtGrapheme(segIdx: number, graphemeIdx: number, width: number) {
		hasContent = true;
		lineStartSeg = segIdx;
		lineStartGrapheme = graphemeIdx;
		lineEndSeg = segIdx;
		lineEndGrapheme = graphemeIdx + 1;
		lineW = width;
	}

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;

		// Hard break: emit current line, start fresh
		if (seg.kind === "hard-break") {
			if (hasContent) {
				flushLine();
			} else {
				// Empty line
				lines.push({
					text: "",
					width: 0,
					startSegment: i,
					startGrapheme: 0,
					endSegment: i,
					endGrapheme: 0,
				});
			}
			lineStartSeg = i + 1;
			lineStartGrapheme = 0;
			continue;
		}

		const w = seg.width;

		if (!hasContent) {
			// First content on a new line
			if (w > maxWidth && seg.graphemeWidths) {
				// Word wider than maxWidth: break at grapheme level
				appendBreakableSegment(i, 0, seg.graphemeWidths);
			} else {
				startLine(i, 0, w);
			}
			if (canBreakAfter(seg.kind)) {
				pendingBreakSeg = i + 1;
				pendingBreakWidth = seg.kind === "space" ? lineW - w : lineW;
			}
			continue;
		}

		const newW = lineW + w;

		if (newW > maxWidth + 0.005) {
			// Overflow
			if (canBreakAfter(seg.kind)) {
				// Trailing space: hang past edge, then break
				lineW += w;
				lineEndSeg = i + 1;
				lineEndGrapheme = 0;
				flushLine(i + 1, 0, seg.kind === "space" ? lineW - w : lineW);
				continue;
			}

			if (pendingBreakSeg >= 0) {
				// Break at last break opportunity
				flushLine(pendingBreakSeg, 0, pendingBreakWidth);
				// Don't advance i — re-process current segment on new line
				i--;
				continue;
			}

			if (w > maxWidth && seg.graphemeWidths) {
				// Break-word: split at grapheme level
				flushLine();
				appendBreakableSegment(i, 0, seg.graphemeWidths);
				continue;
			}

			// No break opportunity: force break before this segment
			flushLine();
			i--;
			continue;
		}

		// Fits on current line
		lineW = newW;
		lineEndSeg = i + 1;
		lineEndGrapheme = 0;

		if (canBreakAfter(seg.kind)) {
			pendingBreakSeg = i + 1;
			pendingBreakWidth = seg.kind === "space" ? lineW - w : lineW;
		}
	}

	if (hasContent) {
		flushLine();
	}

	return { lines, lineCount: lines.length };

	function appendBreakableSegment(segIdx: number, startG: number, gWidths: number[]) {
		for (let g = startG; g < gWidths.length; g++) {
			const gw = gWidths[g]!;
			if (!hasContent) {
				startLineAtGrapheme(segIdx, g, gw);
				continue;
			}
			if (lineW + gw > maxWidth + 0.005) {
				flushLine();
				startLineAtGrapheme(segIdx, g, gw);
			} else {
				lineW += gw;
				lineEndSeg = segIdx;
				lineEndGrapheme = g + 1;
			}
		}
		// If we consumed the whole segment, advance end past it
		if (hasContent && lineEndSeg === segIdx && lineEndGrapheme === gWidths.length) {
			lineEndSeg = segIdx + 1;
			lineEndGrapheme = 0;
		}
	}
}

// ---------------------------------------------------------------------------
// Cursor-based single-line layout (for multi-column flow / shape wrapping)
// ---------------------------------------------------------------------------

function canBreakAfter(kind: SegmentBreakKind): boolean {
	return kind === "space" || kind === "zero-width-break" || kind === "soft-hyphen";
}

function sliceSegmentText(
	seg: PreparedSegment,
	startG: number,
	endG: number,
	segmentAdapter: SegmentAdapter,
): string {
	if (startG === 0 && endG < 0) return seg.text;
	const graphemes = [...segmentAdapter.segmentGraphemes(seg.text)].map((g) => g.segment);
	const stop = endG < 0 ? graphemes.length : endG;
	return graphemes.slice(startG, stop).join("");
}

function buildLineText(
	segments: PreparedSegment[],
	startSeg: number,
	startG: number,
	endSeg: number,
	endG: number,
	appendHyphen: boolean,
	segmentAdapter: SegmentAdapter,
): string {
	let text = "";
	for (let i = startSeg; i < endSeg; i++) {
		const seg = segments[i]!;
		if (seg.kind === "soft-hyphen" || seg.kind === "hard-break") continue;
		if (i === startSeg && startG > 0) {
			text += sliceSegmentText(seg, startG, -1, segmentAdapter);
		} else {
			text += seg.text;
		}
	}
	if (endG > 0 && endSeg < segments.length) {
		const seg = segments[endSeg]!;
		const from = startSeg === endSeg ? startG : 0;
		text += sliceSegmentText(seg, from, endG, segmentAdapter);
	}
	if (appendHyphen) text += "-";
	return text;
}

function resolveHyphenWidth(ctx: LayoutNextLineContext | undefined): number {
	if (!ctx?.adapter || !ctx.font) return 0;
	const cache = ctx.cache;
	if (cache) {
		let fc = cache.get(ctx.font);
		if (!fc) {
			fc = new Map<string, number>();
			cache.set(ctx.font, fc);
		}
		let hw = fc.get("-");
		if (hw === undefined) {
			hw = ctx.adapter.measureSegment("-", ctx.font).width;
			fc.set("-", hw);
		}
		return hw;
	}
	return ctx.adapter.measureSegment("-", ctx.font).width;
}

/**
 * Lay out the next single line starting from `cursor`, fitting into `slotWidth`.
 *
 * Unlike `computeLineBreaks`, which consumes whole text with one `maxWidth`,
 * this is the cursor-based primitive needed when successive lines have different
 * widths (multi-column flow, text wrapping around shape obstacles, mixed
 * column+pullquote layouts).
 *
 * Returns `null` when the cursor is past all segments (text exhausted).
 * At a hard-break with no preceding content, returns an empty line and advances
 * the cursor past the break so the caller can continue.
 *
 * ```ts
 * let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
 * while (true) {
 *   const line = layoutNextLine(segments, cursor, availableWidth);
 *   if (line === null) break;
 *   render(line);
 *   cursor = line.end;
 * }
 * ```
 */
export function layoutNextLine(
	segments: PreparedSegment[],
	cursor: LayoutCursor,
	slotWidth: number,
	ctx?: LayoutNextLineContext,
): LayoutNextLineResult | null {
	let i = cursor.segmentIndex;
	const initialG = cursor.graphemeIndex;
	const segAdapter = ctx?.segmentAdapter ?? getDefaultSegmentAdapter();

	if (i >= segments.length) return null;

	if (initialG === 0) {
		while (i < segments.length) {
			const seg = segments[i]!;
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

	const startSeg = i;
	const startG = i === cursor.segmentIndex ? initialG : 0;

	let lineW = 0;
	let lineEndSeg = startSeg;
	let lineEndG = 0;
	let hasContent = false;
	let pendingBreakSeg = -1;
	let pendingBreakG = 0;
	let pendingBreakWidth = 0;
	let pendingBreakSoftHyphen = false;

	const recordPending = (
		sIdx: number,
		gIdx: number,
		widthAtBreak: number,
		kind: SegmentBreakKind,
	): void => {
		pendingBreakSeg = sIdx;
		pendingBreakG = gIdx;
		pendingBreakWidth = widthAtBreak;
		pendingBreakSoftHyphen = kind === "soft-hyphen";
	};

	const consumeBreakable = (segIdx: number, gStart: number, gWidths: number[]): boolean => {
		for (let g = gStart; g < gWidths.length; g++) {
			const gw = gWidths[g]!;
			if (!hasContent) {
				lineW = gw;
				lineEndSeg = segIdx;
				lineEndG = g + 1;
				hasContent = true;
				continue;
			}
			if (lineW + gw > slotWidth + 0.005) {
				return true;
			}
			lineW += gw;
			lineEndSeg = segIdx;
			lineEndG = g + 1;
		}
		if (lineEndSeg === segIdx && lineEndG === gWidths.length) {
			lineEndSeg = segIdx + 1;
			lineEndG = 0;
		}
		return false;
	};

	if (startG > 0 && startSeg < segments.length) {
		const seg = segments[startSeg]!;
		if (seg.graphemeWidths) {
			const overflowed = consumeBreakable(startSeg, startG, seg.graphemeWidths);
			if (overflowed) {
				const text = buildLineText(
					segments,
					startSeg,
					startG,
					lineEndSeg,
					lineEndG,
					false,
					segAdapter,
				);
				return {
					text,
					width: lineW,
					start: { segmentIndex: startSeg, graphemeIndex: startG },
					end: { segmentIndex: lineEndSeg, graphemeIndex: lineEndG },
				};
			}
			i = lineEndSeg;
		} else {
			// Mid-segment cursor on a non-breakable segment is an invariant
			// violation (cursor should only advance to a grapheme boundary via
			// `consumeBreakable` on a segment that HAS graphemeWidths). Treat as
			// segment-start so the caller gets well-formed output instead of
			// silently re-including the prefix.
			//
			// Not reachable through `computeFlowLines` but possible with
			// externally-constructed cursors.
		}
	}

	for (; i < segments.length; ) {
		const seg = segments[i]!;

		if (seg.kind === "hard-break") {
			if (hasContent) {
				const endsAtSoftHyphen = lineEndSeg > 0 && segments[lineEndSeg - 1]?.kind === "soft-hyphen";
				const text = buildLineText(
					segments,
					startSeg,
					startG,
					lineEndSeg,
					lineEndG,
					endsAtSoftHyphen,
					segAdapter,
				);
				return {
					text,
					width: lineW + (endsAtSoftHyphen ? hyphenWidth : 0),
					start: { segmentIndex: startSeg, graphemeIndex: startG },
					end: { segmentIndex: lineEndSeg, graphemeIndex: lineEndG },
				};
			}
			return {
				text: "",
				width: 0,
				start: { segmentIndex: startSeg, graphemeIndex: startG },
				end: { segmentIndex: i + 1, graphemeIndex: 0 },
			};
		}

		const w = seg.width;

		if (!hasContent) {
			if (w > slotWidth && seg.graphemeWidths) {
				const overflowed = consumeBreakable(i, 0, seg.graphemeWidths);
				if (overflowed) {
					const text = buildLineText(
						segments,
						startSeg,
						startG,
						lineEndSeg,
						lineEndG,
						false,
						segAdapter,
					);
					return {
						text,
						width: lineW,
						start: { segmentIndex: startSeg, graphemeIndex: startG },
						end: { segmentIndex: lineEndSeg, graphemeIndex: lineEndG },
					};
				}
				// No `recordPending` here: segments with `graphemeWidths` are always
				// `kind === "text"` (see `analyzeAndMeasure`), which is not a break-
				// after kind, so the check would always fail.
				i = lineEndSeg;
				continue;
			}
			lineW = w;
			lineEndSeg = i + 1;
			lineEndG = 0;
			hasContent = true;
			if (canBreakAfter(seg.kind)) {
				recordPending(i + 1, 0, seg.kind === "space" ? lineW - w : lineW, seg.kind);
			}
			i += 1;
			continue;
		}

		const newW = lineW + w;

		if (newW > slotWidth + 0.005) {
			if (canBreakAfter(seg.kind)) {
				// `lineW` is carried from before this segment — no mutation needed;
				// trailing space/soft-hyphen width is excluded from the line width.
				lineEndSeg = i + 1;
				lineEndG = 0;
				const endsAtSoftHyphen = seg.kind === "soft-hyphen";
				const finalWidth =
					seg.kind === "space" ? lineW : lineW + (endsAtSoftHyphen ? hyphenWidth : 0);
				const text = buildLineText(
					segments,
					startSeg,
					startG,
					lineEndSeg,
					lineEndG,
					endsAtSoftHyphen,
					segAdapter,
				);
				return {
					text,
					width: finalWidth,
					start: { segmentIndex: startSeg, graphemeIndex: startG },
					end: { segmentIndex: lineEndSeg, graphemeIndex: lineEndG },
				};
			}

			if (pendingBreakSeg >= 0) {
				const text = buildLineText(
					segments,
					startSeg,
					startG,
					pendingBreakSeg,
					pendingBreakG,
					pendingBreakSoftHyphen,
					segAdapter,
				);
				return {
					text,
					width: pendingBreakWidth + (pendingBreakSoftHyphen ? hyphenWidth : 0),
					start: { segmentIndex: startSeg, graphemeIndex: startG },
					end: { segmentIndex: pendingBreakSeg, graphemeIndex: pendingBreakG },
				};
			}

			if (w > slotWidth && seg.graphemeWidths) {
				const text = buildLineText(
					segments,
					startSeg,
					startG,
					lineEndSeg,
					lineEndG,
					false,
					segAdapter,
				);
				return {
					text,
					width: lineW,
					start: { segmentIndex: startSeg, graphemeIndex: startG },
					end: { segmentIndex: lineEndSeg, graphemeIndex: lineEndG },
				};
			}

			const text = buildLineText(
				segments,
				startSeg,
				startG,
				lineEndSeg,
				lineEndG,
				false,
				segAdapter,
			);
			return {
				text,
				width: lineW,
				start: { segmentIndex: startSeg, graphemeIndex: startG },
				end: { segmentIndex: lineEndSeg, graphemeIndex: lineEndG },
			};
		}

		lineW = newW;
		lineEndSeg = i + 1;
		lineEndG = 0;
		if (canBreakAfter(seg.kind)) {
			recordPending(i + 1, 0, seg.kind === "space" ? lineW - w : lineW, seg.kind);
		}
		i += 1;
	}

	if (!hasContent) return null;

	const endsAtSoftHyphen = lineEndSeg > 0 && segments[lineEndSeg - 1]?.kind === "soft-hyphen";
	const text = buildLineText(
		segments,
		startSeg,
		startG,
		lineEndSeg,
		lineEndG,
		endsAtSoftHyphen,
		segAdapter,
	);
	return {
		text,
		width: lineW + (endsAtSoftHyphen ? hyphenWidth : 0),
		start: { segmentIndex: startSeg, graphemeIndex: startG },
		end: { segmentIndex: lineEndSeg, graphemeIndex: lineEndG },
	};
}

// ---------------------------------------------------------------------------
// Slot carving (flow-layout helper)
// ---------------------------------------------------------------------------

/**
 * Subtract blocked horizontal intervals from a base interval, producing
 * remaining ordered, non-overlapping slots wide enough to fit text.
 *
 * Pure geometry — no text dependency. Used by flow-layout to turn obstacle
 * intersections into per-line layout slots.
 *
 * ```ts
 * carveTextLineSlots({left: 0, right: 600}, [{left: 200, right: 280}])
 * // → [{left: 0, right: 200}, {left: 280, right: 600}]
 * ```
 */
export function carveTextLineSlots(
	base: Interval,
	blocked: Interval[],
	minSlotWidth = 0,
): Interval[] {
	let slots: Interval[] = [base];
	for (let bi = 0; bi < blocked.length; bi++) {
		const block = blocked[bi]!;
		const next: Interval[] = [];
		for (let si = 0; si < slots.length; si++) {
			const slot = slots[si]!;
			if (block.right <= slot.left || block.left >= slot.right) {
				next.push(slot);
				continue;
			}
			if (block.left > slot.left) next.push({ left: slot.left, right: block.left });
			if (block.right < slot.right) next.push({ left: block.right, right: slot.right });
		}
		slots = next;
	}
	if (minSlotWidth > 0) {
		return slots.filter((s) => s.right - s.left >= minSlotWidth);
	}
	return slots;
}

// ---------------------------------------------------------------------------
// Character positions
// ---------------------------------------------------------------------------

/** Compute per-character x,y positions from line breaks and segments. */
export function computeCharPositions(
	lineBreaks: LineBreaksResult,
	segments: PreparedSegment[],
	lineHeight: number,
	segmentAdapter?: SegmentAdapter,
): CharPosition[] {
	const positions: CharPosition[] = [];
	const segAdapter = segmentAdapter ?? getDefaultSegmentAdapter();

	for (let lineIdx = 0; lineIdx < lineBreaks.lines.length; lineIdx++) {
		const line = lineBreaks.lines[lineIdx]!;
		const y = lineIdx * lineHeight;
		let x = 0;

		for (let si = line.startSegment; si < segments.length; si++) {
			const seg = segments[si]!;
			if (seg.kind === "soft-hyphen" || seg.kind === "hard-break") {
				// Skip non-visual segments but stop if past the line
				if (si >= line.endSegment && line.endGrapheme === 0) break;
				continue;
			}

			const graphemes = [...segAdapter.segmentGraphemes(seg.text)].map((g) => g.segment);
			if (graphemes.length === 0) continue;
			const startG = si === line.startSegment ? line.startGrapheme : 0;

			// Determine how many graphemes of this segment belong to this line
			let endG: number;
			if (si < line.endSegment) {
				// Full segment is on this line
				endG = graphemes.length;
			} else if (si === line.endSegment && line.endGrapheme > 0) {
				// Partial segment (grapheme-level break)
				endG = line.endGrapheme;
			} else {
				// Past the line's content
				break;
			}

			for (let g = startG; g < endG; g++) {
				const gWidth = seg.graphemeWidths ? seg.graphemeWidths[g]! : seg.width / graphemes.length;
				positions.push({ x, y, width: gWidth, height: lineHeight, line: lineIdx });
				x += gWidth;
			}
		}
	}

	return positions;
}

// ---------------------------------------------------------------------------
// Reactive graph factory
// ---------------------------------------------------------------------------

export type ReactiveLayoutOptions = {
	/** Measurement backend (required). */
	adapter: MeasurementAdapter;
	/**
	 * Segmentation backend (optional). Defaults to a lazy {@link IntlSegmentAdapter}
	 * (uses platform `Intl.Segmenter`). **Required on Hermes / RN** where
	 * `Intl.Segmenter` is undefined — wire a polyfilled {@link SegmentAdapter}
	 * here. See {@link SegmentAdapter} JSDoc for the polyfill recipe.
	 */
	segmentAdapter?: SegmentAdapter;
	/** Graph name (default: "reactive-layout"). */
	name?: string;
	/** Initial text. */
	text?: string;
	/** Initial CSS font string. */
	font?: string;
	/** Initial line height in px. */
	lineHeight?: number;
	/** Initial max width in px (clamped to ≥ 0). */
	maxWidth?: number;
};

/**
 * Create a reactive text layout graph.
 *
 * ```
 * Graph("reactive-layout")
 * ├── node([], { initial: "text" })
 * ├── node([], { initial: "font" })
 * ├── node([], { initial: "line-height" })
 * ├── node([], { initial: "max-width" })
 * ├── derived("segments")      — text + font → PreparedSegment[]
 * ├── derived("line-breaks")   — segments + max-width → LineBreaksResult
 * ├── derived("height")        — line-breaks → number
 * └── derived("char-positions") — line-breaks + segments → CharPosition[]
 * ```
 */
export function reactiveLayout(opts: ReactiveLayoutOptions): ReactiveLayoutBundle {
	const { adapter, segmentAdapter: segmentAdapterOpt, name = "reactive-layout" } = opts;
	// Resolve eagerly so a Hermes consumer without an explicit `segmentAdapter`
	// sees the clear `IntlSegmentAdapter` "supply a SegmentAdapter" error at
	// factory construction time (not later, on first text wave). When the
	// caller wires their own, no `Intl.Segmenter` access happens here.
	const segmentAdapter: SegmentAdapter = segmentAdapterOpt ?? getDefaultSegmentAdapter();
	const g = new Graph({ name });

	// Shared measurement cache: Map<font, Map<segment, width>>
	const measureCache = new Map<string, Map<string, number>>();

	// --- State nodes ---
	const textNode = g.state<string>(opts.text ?? "", { name: "text" });
	const fontNode = g.state<string>(opts.font ?? "16px sans-serif", {
		name: "font",
	});
	const lineHeightNode = g.state<number>(opts.lineHeight ?? 20, {
		name: "line-height",
	});
	const maxWidthNode = g.state<number>(Math.max(0, opts.maxWidth ?? 800), {
		name: "max-width",
	});

	const segmentsNode: Node<PreparedSegment[]> = g.node<PreparedSegment[]>(
		[textNode, fontNode],
		(ctx) => {
			const flush = (): void => {
				measureCache.clear();
				adapter.clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);

			const textVal = depLatest(ctx, 0) as string;
			const fontVal = depLatest(ctx, 1) as string;
			const result = analyzeAndMeasure(
				textVal,
				fontVal,
				adapter,
				measureCache,
				undefined,
				segmentAdapter,
			);
			ctx.down([["DATA", result]]);
		},
		{
			name: "segments",
		},
	);

	// --- Derived: line-breaks (segments + max-width + font → LineBreaksResult) ---
	const lineBreaksNode = g.node<LineBreaksResult>(
		[segmentsNode, maxWidthNode, fontNode],
		(ctx) => {
			ctx.down([
				[
					"DATA",
					computeLineBreaks(
						depLatest(ctx, 0) as PreparedSegment[],
						depLatest(ctx, 1) as number,
						adapter,
						depLatest(ctx, 2) as string,
						measureCache,
						segmentAdapter,
					),
				],
			]);
		},
		{
			name: "line-breaks",
		},
	);

	// --- Derived: height ---
	const heightNode = g.node<number>(
		[lineBreaksNode, lineHeightNode],
		(ctx) => {
			ctx.down([
				["DATA", (depLatest(ctx, 0) as LineBreaksResult).lineCount * (depLatest(ctx, 1) as number)],
			]);
		},
		{ name: "height" },
	);

	// --- Derived: char-positions ---
	const charPositionsNode = g.node<CharPosition[]>(
		[lineBreaksNode, segmentsNode, lineHeightNode],
		(ctx) => {
			ctx.down([
				[
					"DATA",
					computeCharPositions(
						depLatest(ctx, 0) as LineBreaksResult,
						depLatest(ctx, 1) as PreparedSegment[],
						depLatest(ctx, 2) as number,
						segmentAdapter,
					),
				],
			]);
		},
		{
			name: "char-positions",
		},
	);

	return {
		graph: g,
		setText: (text: string) => textNode.set(text),
		setFont: (font: string) => fontNode.set(font),
		setLineHeight: (lh: number) => lineHeightNode.set(lh),
		setMaxWidth: (mw: number) => maxWidthNode.set(Math.max(0, mw)),
		segments: segmentsNode,
		lineBreaks: lineBreaksNode,
		height: heightNode,
		charPositions: charPositionsNode,
	};
}

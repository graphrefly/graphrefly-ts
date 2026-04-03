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
import { emitWithBatch } from "../../core/batch.js";
import { monotonicNs } from "../../core/clock.js";
import { DATA, INVALIDATE } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pluggable measurement backend. */
export interface MeasurementAdapter {
	measureSegment(text: string, font: string): { width: number };
	/** Optional; adapters may omit for read-only / stateless measurement. */
	clearCache?(): void;
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
 * Segment text using Intl.Segmenter (word granularity) and classify break kinds.
 * Returns raw segmentation pieces before merging.
 */
function segmentText(normalized: string): {
	texts: string[];
	isWordLike: boolean[];
	kinds: SegmentBreakKind[];
}[] {
	const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
	const pieces: {
		texts: string[];
		isWordLike: boolean[];
		kinds: SegmentBreakKind[];
	}[] = [];

	for (const s of wordSegmenter.segment(normalized)) {
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
): PreparedSegment[] {
	const normalized = normalizeWhitespace(text);
	if (normalized.length === 0) return [];

	const pieces = segmentText(normalized);
	const graphemeSegmenter = new Intl.Segmenter(undefined, {
		granularity: "grapheme",
	});

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
			w = adapter.measureSegment(seg, font).width;
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
			for (const gs of graphemeSegmenter.segment(t)) {
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
			for (const gs of graphemeSegmenter.segment(t)) {
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
): LineBreaksResult {
	if (segments.length === 0) {
		return { lines: [], lineCount: 0 };
	}

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

	function emitLine(endSeg = lineEndSeg, endGrapheme = lineEndGrapheme, width = lineW) {
		// Build line text
		let text = "";
		for (let i = lineStartSeg; i < endSeg; i++) {
			const seg = segments[i]!;
			if (seg.kind === "soft-hyphen" || seg.kind === "hard-break") continue;
			if (i === lineStartSeg && lineStartGrapheme > 0 && seg.graphemeWidths) {
				// Partial segment from grapheme break
				const graphemeSegmenter = new Intl.Segmenter(undefined, {
					granularity: "grapheme",
				});
				const graphemes = [...graphemeSegmenter.segment(seg.text)].map((g) => g.segment);
				text += graphemes.slice(lineStartGrapheme).join("");
			} else {
				text += seg.text;
			}
		}
		// Handle partial end segment
		if (endGrapheme > 0 && endSeg < segments.length) {
			const seg = segments[endSeg]!;
			const graphemeSegmenter = new Intl.Segmenter(undefined, {
				granularity: "grapheme",
			});
			const graphemes = [...graphemeSegmenter.segment(seg.text)].map((g) => g.segment);
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
				emitLine();
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
				emitLine(i + 1, 0, seg.kind === "space" ? lineW - w : lineW);
				continue;
			}

			if (pendingBreakSeg >= 0) {
				// Break at last break opportunity
				emitLine(pendingBreakSeg, 0, pendingBreakWidth);
				// Don't advance i — re-process current segment on new line
				i--;
				continue;
			}

			if (w > maxWidth && seg.graphemeWidths) {
				// Break-word: split at grapheme level
				emitLine();
				appendBreakableSegment(i, 0, seg.graphemeWidths);
				continue;
			}

			// No break opportunity: force break before this segment
			emitLine();
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
		emitLine();
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
				emitLine();
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
// Character positions
// ---------------------------------------------------------------------------

/** Compute per-character x,y positions from line breaks and segments. */
export function computeCharPositions(
	lineBreaks: LineBreaksResult,
	segments: PreparedSegment[],
	lineHeight: number,
): CharPosition[] {
	const positions: CharPosition[] = [];
	const graphemeSegmenter = new Intl.Segmenter(undefined, {
		granularity: "grapheme",
	});

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

			const graphemes = [...graphemeSegmenter.segment(seg.text)].map((g) => g.segment);
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
 * ├── state("text")
 * ├── state("font")
 * ├── state("line-height")
 * ├── state("max-width")
 * ├── derived("segments")      — text + font → PreparedSegment[]
 * ├── derived("line-breaks")   — segments + max-width → LineBreaksResult
 * ├── derived("height")        — line-breaks → number
 * └── derived("char-positions") — line-breaks + segments → CharPosition[]
 * ```
 */
export function reactiveLayout(opts: ReactiveLayoutOptions): ReactiveLayoutBundle {
	const { adapter, name = "reactive-layout" } = opts;
	const g = new Graph(name);

	// Shared measurement cache: Map<font, Map<segment, width>>
	const measureCache = new Map<string, Map<string, number>>();

	// --- State nodes ---
	const textNode = state<string>(opts.text ?? "", { name: "text" });
	const fontNode = state<string>(opts.font ?? "16px sans-serif", {
		name: "font",
	});
	const lineHeightNode = state<number>(opts.lineHeight ?? 20, {
		name: "line-height",
	});
	const maxWidthNode = state<number>(Math.max(0, opts.maxWidth ?? 800), {
		name: "max-width",
	});

	// --- Derived: segments (text + font → PreparedSegment[]) ---
	function graphemeWidthsEqual(a: number[] | null, b: number[] | null): boolean {
		if (a === null || b === null) return a === b;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]!) return false;
		}
		return true;
	}

	const segmentsNode = derived<PreparedSegment[]>(
		[textNode, fontNode],
		([textVal, fontVal]) => {
			const t0 = monotonicNs();
			const measureStats: SegmentMeasureStats = { hits: 0, misses: 0 };
			const result = analyzeAndMeasure(
				textVal as string,
				fontVal as string,
				adapter,
				measureCache,
				measureStats,
			);
			const elapsed = monotonicNs() - t0;

			const lookups = measureStats.hits + measureStats.misses;
			const hitRate = lookups === 0 ? 1 : measureStats.hits / lookups;

			// After parent `segments` auto-emits DATA/RESOLVED, deliver metrics
			// via phase-3 deferral so observers see the parent value first.
			// Phase-3 drains after all phase-2 work (parent settlements) completes
			// (parity with Python `defer_down` → `emit_with_batch_phase3`).
			const meta = segmentsNode.meta;
			if (meta) {
				const hr = hitRate;
				const len = result.length;
				const el = elapsed;
				emitWithBatch((msgs) => meta["cache-hit-rate"]?.down(msgs), [[DATA, hr]], 3);
				emitWithBatch((msgs) => meta["segment-count"]?.down(msgs), [[DATA, len]], 3);
				emitWithBatch((msgs) => meta["layout-time-ns"]?.down(msgs), [[DATA, el]], 3);
			}

			return result;
		},
		{
			name: "segments",
			meta: {
				"cache-hit-rate": 0,
				"segment-count": 0,
				"layout-time-ns": 0,
			},
			onMessage(msg) {
				if (msg[0] === INVALIDATE) {
					// Spec: INVALIDATE clears cached state. Our measurement cache lives
					// in a closure, so we must clear it explicitly.
					measureCache.clear();
					adapter.clearCache?.();
				}
				return false;
			},
			equals: (a, b) => {
				const sa = a as PreparedSegment[] | null;
				const sb = b as PreparedSegment[] | null;
				if (sa == null || sb == null) return sa === sb;
				if (sa.length !== sb.length) return false;
				for (let i = 0; i < sa.length; i++) {
					const pa = sa[i]!;
					const pb = sb[i]!;
					if (
						pa.text !== pb.text ||
						pa.width !== pb.width ||
						pa.kind !== pb.kind ||
						!graphemeWidthsEqual(pa.graphemeWidths ?? null, pb.graphemeWidths ?? null)
					)
						return false;
				}
				return true;
			},
		},
	);

	// --- Derived: line-breaks (segments + max-width + font → LineBreaksResult) ---
	const lineBreaksNode = derived<LineBreaksResult>(
		[segmentsNode, maxWidthNode, fontNode],
		([segs, mw, font]) => {
			return computeLineBreaks(
				segs as PreparedSegment[],
				mw as number,
				adapter,
				font as string,
				measureCache,
			);
		},
		{
			name: "line-breaks",
			equals: (a, b) => {
				const la = a as LineBreaksResult | null;
				const lb = b as LineBreaksResult | null;
				if (la == null || lb == null) return la === lb;
				if (la.lineCount !== lb.lineCount) return false;
				for (let i = 0; i < la.lines.length; i++) {
					const lineA = la.lines[i]!;
					const lineB = lb.lines[i]!;
					if (
						lineA.text !== lineB.text ||
						lineA.width !== lineB.width ||
						lineA.startSegment !== lineB.startSegment ||
						lineA.startGrapheme !== lineB.startGrapheme ||
						lineA.endSegment !== lineB.endSegment ||
						lineA.endGrapheme !== lineB.endGrapheme
					)
						return false;
				}
				return true;
			},
		},
	);

	// --- Derived: height ---
	const heightNode = derived<number>(
		[lineBreaksNode, lineHeightNode],
		([lb, lh]) => (lb as LineBreaksResult).lineCount * (lh as number),
		{ name: "height" },
	);

	// --- Derived: char-positions ---
	const charPositionsNode = derived<CharPosition[]>(
		[lineBreaksNode, segmentsNode, lineHeightNode],
		([lb, segs, lh]) => {
			return computeCharPositions(lb as LineBreaksResult, segs as PreparedSegment[], lh as number);
		},
		{
			name: "char-positions",
			equals: (a, b) => {
				const ca = a as CharPosition[] | null;
				const cb = b as CharPosition[] | null;
				if (ca == null || cb == null) return ca === cb;
				if (ca.length !== cb.length) return false;
				for (let i = 0; i < ca.length; i++) {
					if (ca[i]!.x !== cb[i]!.x || ca[i]!.y !== cb[i]!.y || ca[i]!.width !== cb[i]!.width)
						return false;
				}
				return true;
			},
		},
	);

	// --- Register in graph ---
	g.add("text", textNode);
	g.add("font", fontNode);
	g.add("line-height", lineHeightNode);
	g.add("max-width", maxWidthNode);
	g.add("segments", segmentsNode);
	g.add("line-breaks", lineBreaksNode);
	g.add("height", heightNode);
	g.add("char-positions", charPositionsNode);

	// --- Edges (for describe() visibility) ---
	g.connect("text", "segments");
	g.connect("font", "segments");
	g.connect("segments", "line-breaks");
	g.connect("max-width", "line-breaks");
	g.connect("font", "line-breaks");
	g.connect("line-breaks", "height");
	g.connect("line-height", "height");
	g.connect("line-breaks", "char-positions");
	g.connect("segments", "char-positions");
	g.connect("line-height", "char-positions");

	return {
		graph: g,
		setText: (text: string) => g.set("text", text),
		setFont: (font: string) => g.set("font", font),
		setLineHeight: (lh: number) => g.set("line-height", lh),
		setMaxWidth: (mw: number) => g.set("max-width", Math.max(0, mw)),
		segments: segmentsNode,
		lineBreaks: lineBreaksNode,
		height: heightNode,
		charPositions: charPositionsNode,
	};
}

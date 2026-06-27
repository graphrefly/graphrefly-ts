import {
	getDefaultSegmentAdapter,
	isCJK,
	kinsokuStart,
	leftStickyPunctuation,
	normalizeWhitespace,
	segmentText,
} from "./segment.js";
import type {
	CharPosition,
	Interval,
	LayoutCursor,
	LayoutLine,
	LayoutNextLineContext,
	LayoutNextLineResult,
	LineBreaksResult,
	MeasurementAdapter,
	PreparedSegment,
	SegmentAdapter,
	SegmentBreakKind,
	SegmentMeasureStats,
} from "./types.js";
import { nonNegativeFinite } from "./utils.js";

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

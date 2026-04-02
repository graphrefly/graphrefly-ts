/**
 * MeasurementAdapter implementations (roadmap §7.1 — pluggable backends).
 *
 * All adapters implement {@link MeasurementAdapter} from `reactive-layout.ts`.
 * Sync constructors, sync `measureSegment()` — no async, no polling.
 */
import type { MeasurementAdapter } from "./reactive-layout.js";

// ---------------------------------------------------------------------------
// Shared: East Asian Width detection for CLI adapter
// ---------------------------------------------------------------------------

/**
 * Return the display-cell width of a single codepoint in a monospace terminal.
 * Fullwidth / wide CJK → 2 cells; combining marks → 0 cells; everything else → 1 cell.
 *
 * Approximates UAX #11 East_Asian_Width (W/F → 2). Not a full EAW table —
 * covers CJK, Hangul, fullwidth forms, common emoji, and Extensions B-G.
 * Python's `unicodedata.east_asian_width()` is authoritative; this tracks it
 * closely but may diverge on rare/ambiguous codepoints.
 */
function cellWidth(code: number): 0 | 1 | 2 {
	// Combining marks (Mn, Mc, Me) → 0 cells
	if (
		(code >= 0x0300 && code <= 0x036f) || // Combining Diacritical Marks
		(code >= 0x0483 && code <= 0x0489) || // Cyrillic combining marks
		(code >= 0x0591 && code <= 0x05bd) || // Hebrew combining marks
		(code >= 0x0610 && code <= 0x061a) || // Arabic combining marks
		(code >= 0x064b && code <= 0x065f) || // Arabic combining marks
		(code >= 0x0670 && code === 0x0670) || // Arabic superscript alef
		(code >= 0x06d6 && code <= 0x06dc) || // Arabic combining marks
		(code >= 0x06df && code <= 0x06e4) || // Arabic combining marks
		(code >= 0x06e7 && code <= 0x06e8) || // Arabic combining marks
		(code >= 0x06ea && code <= 0x06ed) || // Arabic combining marks
		(code >= 0x0730 && code <= 0x074a) || // Syriac combining marks
		(code >= 0x07a6 && code <= 0x07b0) || // Thaana combining marks
		(code >= 0x0900 && code <= 0x0903) || // Devanagari combining marks
		(code >= 0x093a && code <= 0x094f) || // Devanagari combining marks
		(code >= 0x0951 && code <= 0x0957) || // Devanagari combining marks
		(code >= 0x0962 && code <= 0x0963) || // Devanagari combining marks
		(code >= 0x0981 && code <= 0x0983) || // Bengali combining marks
		(code >= 0x09bc && code <= 0x09cd) || // Bengali combining marks
		(code >= 0x0a01 && code <= 0x0a03) || // Gurmukhi combining marks
		(code >= 0x0a3c && code <= 0x0a51) || // Gurmukhi combining marks
		(code >= 0x0a70 && code <= 0x0a71) || // Gurmukhi combining marks
		(code >= 0x0a75 && code === 0x0a75) || // Gurmukhi combining mark
		(code >= 0x0e31 && code === 0x0e31) || // Thai combining mark
		(code >= 0x0e34 && code <= 0x0e3a) || // Thai combining marks
		(code >= 0x0e47 && code <= 0x0e4e) || // Thai combining marks
		(code >= 0x0eb1 && code === 0x0eb1) || // Lao combining mark
		(code >= 0x0eb4 && code <= 0x0ebc) || // Lao combining marks
		(code >= 0x0ec8 && code <= 0x0ece) || // Lao combining marks
		(code >= 0x1dc0 && code <= 0x1dff) || // Combining Diacritical Marks Supplement
		(code >= 0x20d0 && code <= 0x20ff) || // Combining Diacritical Marks for Symbols
		(code >= 0xfe00 && code <= 0xfe0f) || // Variation Selectors
		(code >= 0xfe20 && code <= 0xfe2f) || // Combining Half Marks
		code === 0x200d // Zero Width Joiner
	) {
		return 0;
	}
	// Wide / fullwidth → 2 cells
	if (
		(code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
		(code >= 0x231a && code <= 0x231b) || // Watch, Hourglass
		(code >= 0x2329 && code <= 0x232a) || // Angle brackets
		(code >= 0x23e9 && code <= 0x23f3) || // Media control symbols
		(code >= 0x23f8 && code <= 0x23fa) || // Media control symbols
		(code >= 0x25fd && code <= 0x25fe) || // Medium squares
		(code >= 0x2614 && code <= 0x2615) || // Umbrella, Hot Beverage
		(code >= 0x2648 && code <= 0x2653) || // Zodiac symbols
		code === 0x267f || // Wheelchair
		code === 0x2693 || // Anchor
		code === 0x26a1 || // High Voltage
		(code >= 0x26aa && code <= 0x26ab) || // Medium circles
		(code >= 0x26bd && code <= 0x26be) || // Soccer, Baseball
		(code >= 0x26c4 && code <= 0x26c5) || // Snowman, Sun behind cloud
		code === 0x26ce || // Ophiuchus
		code === 0x26d4 || // No Entry
		code === 0x26ea || // Church
		(code >= 0x26f2 && code <= 0x26f3) || // Fountain, Golf
		code === 0x26f5 || // Sailboat
		code === 0x26fa || // Tent
		code === 0x26fd || // Fuel Pump
		code === 0x2702 || // Scissors
		code === 0x2705 || // Check Mark
		(code >= 0x2708 && code <= 0x270d) || // Airplane...Writing Hand
		code === 0x270f || // Pencil
		(code >= 0x2753 && code <= 0x2755) || // Question marks
		code === 0x2757 || // Exclamation
		(code >= 0x2795 && code <= 0x2797) || // Plus, Minus, Divide
		code === 0x27b0 || // Curly Loop
		code === 0x27bf || // Double Curly Loop
		(code >= 0x2934 && code <= 0x2935) || // Arrows
		(code >= 0x2b05 && code <= 0x2b07) || // Arrows
		(code >= 0x2b1b && code <= 0x2b1c) || // Squares
		code === 0x2b50 || // Star
		code === 0x2b55 || // Circle
		(code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Symbols, Punctuation
		(code >= 0x3040 && code <= 0x309f) || // Hiragana
		(code >= 0x30a0 && code <= 0x30ff) || // Katakana
		(code >= 0x3105 && code <= 0x312f) || // Bopomofo
		(code >= 0x3131 && code <= 0x318e) || // Hangul Compatibility Jamo
		(code >= 0x3190 && code <= 0x31e3) || // Kanbun, CJK Strokes
		(code >= 0x31f0 && code <= 0x321e) || // Katakana Phonetic Extensions
		(code >= 0x3220 && code <= 0x3247) || // Enclosed CJK
		(code >= 0x3250 && code <= 0x4dbf) || // CJK Extensions + Unified block
		(code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
		(code >= 0xa960 && code <= 0xa97c) || // Hangul Jamo Extended-A
		(code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
		(code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
		(code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
		(code >= 0xfe30 && code <= 0xfe6b) || // CJK Compatibility Forms
		(code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms (excl. halfwidth)
		(code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
		(code >= 0x1f004 && code === 0x1f004) || // Mahjong Red Dragon
		code === 0x1f0cf || // Joker
		(code >= 0x1f170 && code <= 0x1f171) || // A/B buttons
		code === 0x1f17e || // O button
		code === 0x1f17f || // P button
		code === 0x1f18e || // AB button
		(code >= 0x1f191 && code <= 0x1f19a) || // Squared symbols
		(code >= 0x1f1e0 && code <= 0x1f1ff) || // Regional Indicator Symbols
		(code >= 0x1f200 && code <= 0x1f202) || // Enclosed ideographic
		code === 0x1f21a || // Squared CJK
		code === 0x1f22f || // Squared CJK
		(code >= 0x1f232 && code <= 0x1f23a) || // Squared CJK
		(code >= 0x1f250 && code <= 0x1f251) || // Circled ideographic
		(code >= 0x1f300 && code <= 0x1f9ff) || // Misc Symbols / Emoticons / Emoji
		(code >= 0x1fa00 && code <= 0x1faff) || // Chess, Symbols Extended-A
		(code >= 0x1fb00 && code <= 0x1fbff) || // Symbols for Legacy Computing
		(code >= 0x20000 && code <= 0x2fffd) || // CJK Extension B-F (excl. nonchars)
		(code >= 0x30000 && code <= 0x3fffd) // CJK Extension G+ (excl. nonchars)
	) {
		return 2;
	}
	return 1;
}

/**
 * Count total display cells for a string in a monospace terminal.
 *
 * Combining marks contribute 0 cells; CJK/fullwidth contribute 2.
 * Does not handle ZWJ emoji sequences (multi-codepoint clusters that
 * render as a single glyph) — terminal support for these varies widely.
 */
function countCells(text: string): number {
	let cells = 0;
	for (const ch of text) {
		cells += cellWidth(ch.codePointAt(0)!);
	}
	return cells;
}

// ---------------------------------------------------------------------------
// CliMeasureAdapter
// ---------------------------------------------------------------------------

export type CliMeasureAdapterOptions = {
	/** Pixel width per terminal cell (default: 8). */
	cellPx?: number;
};

/**
 * Monospace terminal measurement adapter.
 *
 * Width = cell count × `cellPx`. CJK / fullwidth characters count as 2 cells.
 * No external dependencies. Works in any JS environment.
 */
export class CliMeasureAdapter implements MeasurementAdapter {
	private readonly cellPx: number;

	constructor(opts?: CliMeasureAdapterOptions) {
		this.cellPx = opts?.cellPx ?? 8;
	}

	measureSegment(text: string, _font: string): { width: number } {
		return { width: countCells(text) * this.cellPx };
	}
}

// ---------------------------------------------------------------------------
// PrecomputedAdapter
// ---------------------------------------------------------------------------

export type PrecomputedAdapterOptions = {
	/**
	 * Pre-computed metrics: `{ font: { segment: widthPx } }`.
	 * Outer key is the CSS font string; inner key is the text segment.
	 */
	metrics: Record<string, Record<string, number>>;
	/**
	 * Fallback when a segment is not found in the metrics map.
	 * - `"per-char"`: sum individual character widths from the same font map (default)
	 * - `"error"`: throw an error for unknown segments
	 */
	fallback?: "per-char" | "error";
};

class PrecomputedAdapterKeyError extends Error {
	name = "KeyError";
}

/**
 * Pre-computed measurement adapter for SSR / snapshot replay.
 *
 * Reads from a static metrics object — zero measurement at runtime.
 * Ideal for server-side rendering or replaying snapshotted layouts.
 */
export class PrecomputedAdapter implements MeasurementAdapter {
	private readonly metrics: Record<string, Record<string, number>>;
	private readonly fallback: "per-char" | "error";

	constructor(opts: PrecomputedAdapterOptions) {
		this.metrics = opts.metrics;
		const fb = opts.fallback ?? "per-char";
		if (fb !== "per-char" && fb !== "error") {
			// Keep parity with Python: validate at runtime.
			throw new Error(
				`fallback must be 'per-char' or 'error', got ${JSON.stringify(opts.fallback)}`,
			);
		}
		this.fallback = fb;
	}

	measureSegment(text: string, font: string): { width: number } {
		const fontMap = this.metrics[font];
		if (fontMap) {
			const w = fontMap[text];
			if (w !== undefined) return { width: w };
		}

		if (this.fallback === "error") {
			throw new PrecomputedAdapterKeyError(
				`PrecomputedAdapter: no metrics for segment ${JSON.stringify(text)} in font ${JSON.stringify(font)}`,
			);
		}

		// per-char fallback: sum individual character widths
		let total = 0;
		if (fontMap) {
			for (const ch of text) {
				const cw = fontMap[ch];
				if (cw !== undefined) {
					total += cw;
				}
				// unknown char contributes 0 (best-effort)
			}
		}
		return { width: total };
	}
}

// ---------------------------------------------------------------------------
// CanvasMeasureAdapter (browser)
// ---------------------------------------------------------------------------

export type CanvasMeasureAdapterOptions = {
	/** Emoji width correction factor (default: 1, no correction). */
	emojiCorrection?: number;
};

/**
 * Browser measurement adapter using `OffscreenCanvas.measureText()`.
 *
 * Lazily creates an OffscreenCanvas and 2D context on first call.
 * Requires a browser environment with OffscreenCanvas support.
 */
export class CanvasMeasureAdapter implements MeasurementAdapter {
	private ctx: OffscreenCanvasRenderingContext2D | null = null;
	private currentFont = "";
	private readonly emojiCorrection: number;

	constructor(opts?: CanvasMeasureAdapterOptions) {
		this.emojiCorrection = opts?.emojiCorrection ?? 1;
	}

	private getContext(): OffscreenCanvasRenderingContext2D {
		if (!this.ctx) {
			if (typeof OffscreenCanvas === "undefined") {
				throw new Error(
					"CanvasMeasureAdapter requires a browser environment with OffscreenCanvas support. " +
						"Use CliMeasureAdapter or NodeCanvasMeasureAdapter for Node.js.",
				);
			}
			const canvas = new OffscreenCanvas(0, 0);
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("CanvasMeasureAdapter: failed to get 2d context");
			this.ctx = ctx;
		}
		return this.ctx;
	}

	measureSegment(text: string, font: string): { width: number } {
		const ctx = this.getContext();
		if (font !== this.currentFont) {
			ctx.font = font;
			this.currentFont = font;
		}
		let width = ctx.measureText(text).width;
		// Apply emoji correction if configured
		if (this.emojiCorrection !== 1 && /\p{Emoji_Presentation}/u.test(text)) {
			width *= this.emojiCorrection;
		}
		return { width };
	}

	clearCache(): void {
		// No segment cache; context font is the only state.
		this.currentFont = "";
	}
}

// ---------------------------------------------------------------------------
// NodeCanvasMeasureAdapter (Node.js / CLI with canvas package)
// ---------------------------------------------------------------------------

/**
 * Canvas API subset expected from `@napi-rs/canvas` or `skia-canvas`.
 * Passed via dependency injection — no dynamic import, no polling.
 */
export type CanvasModule = {
	createCanvas(
		width: number,
		height: number,
	): {
		getContext(type: "2d"): {
			font: string;
			measureText(text: string): { width: number };
		};
	};
};

/**
 * Node.js measurement adapter using an injected canvas module.
 *
 * ```ts
 * import * as canvas from "@napi-rs/canvas";
 * const adapter = new NodeCanvasMeasureAdapter(canvas);
 * ```
 *
 * Works with `@napi-rs/canvas`, `skia-canvas`, or any module exposing
 * `createCanvas(w, h).getContext("2d").measureText(text)`.
 */
export class NodeCanvasMeasureAdapter implements MeasurementAdapter {
	private ctx: { font: string; measureText(text: string): { width: number } } | null = null;
	private currentFont = "";
	private readonly canvasModule: CanvasModule;

	constructor(canvasModule: CanvasModule) {
		this.canvasModule = canvasModule;
	}

	private getContext(): { font: string; measureText(text: string): { width: number } } {
		if (!this.ctx) {
			const canvas = this.canvasModule.createCanvas(0, 0);
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("NodeCanvasMeasureAdapter: failed to get 2d context");
			this.ctx = ctx;
		}
		return this.ctx;
	}

	measureSegment(text: string, font: string): { width: number } {
		const ctx = this.getContext();
		if (font !== this.currentFont) {
			ctx.font = font;
			this.currentFont = font;
		}
		return { width: ctx.measureText(text).width };
	}

	clearCache(): void {
		this.currentFont = "";
	}
}

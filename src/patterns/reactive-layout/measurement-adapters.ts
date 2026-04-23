/**
 * MeasurementAdapter implementations (roadmap §7.1 — pluggable backends).
 *
 * All adapters implement {@link MeasurementAdapter} from `reactive-layout.ts`.
 * Sync constructors, sync `measureSegment()` — no async, no polling.
 */

import { countCells } from "../../graph/_ascii-width.js";
import type { MeasurementAdapter } from "./reactive-layout.js";

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

// ---------------------------------------------------------------------------
// SvgBoundsAdapter
// ---------------------------------------------------------------------------

/**
 * SVG measurement adapter — extracts dimensions from `viewBox` attribute
 * or explicit `width`/`height` attributes in the SVG string.
 *
 * Pure arithmetic: parses the SVG string for dimension attributes.
 * No DOM required. Works in any JS environment.
 *
 * Browser users who need `getBBox()` should pre-measure and pass explicit
 * `viewBox` on the content block instead.
 */
export class SvgBoundsAdapter {
	measureSvg(content: string): { width: number; height: number } {
		// Try viewBox first: viewBox="minX minY width height"
		const viewBoxMatch = content.match(/viewBox\s*=\s*["']([^"']+)["']/);
		if (viewBoxMatch) {
			const parts = viewBoxMatch[1]!.trim().split(/[\s,]+/);
			if (parts.length >= 4) {
				const w = Number.parseFloat(parts[2]!);
				const h = Number.parseFloat(parts[3]!);
				if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
					return { width: w, height: h };
				}
				throw new Error(
					"SvgBoundsAdapter: viewBox width/height are missing, non-finite, or not positive",
				);
			}
		}

		// Fall back to explicit width/height attributes
		const widthMatch = content.match(/<svg[^>]*\bwidth\s*=\s*["']?([\d.]+)/);
		const heightMatch = content.match(/<svg[^>]*\bheight\s*=\s*["']?([\d.]+)/);
		if (widthMatch && heightMatch) {
			const w = Number.parseFloat(widthMatch[1]!);
			const h = Number.parseFloat(heightMatch[1]!);
			if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
				return { width: w, height: h };
			}
			throw new Error(
				"SvgBoundsAdapter: svg width/height attributes are non-finite or not positive",
			);
		}

		throw new Error(
			"SvgBoundsAdapter: cannot determine dimensions — SVG has no viewBox or width/height attributes",
		);
	}
}

// ---------------------------------------------------------------------------
// ImageSizeAdapter
// ---------------------------------------------------------------------------

/**
 * Image measurement adapter — returns pre-registered dimensions by src key.
 *
 * Sync-only: dimensions must be provided upfront via the `sizes` map.
 * No I/O, no polling, no async. For browser use, pre-measure via
 * `Image.onload` and pass natural dimensions on the content block directly,
 * or register them here.
 *
 * ```ts
 * const adapter = new ImageSizeAdapter({
 *   "hero.png": { width: 1200, height: 630 },
 *   "logo.svg": { width: 120, height: 40 },
 * });
 * ```
 */
export class ImageSizeAdapter {
	private readonly sizes: Map<string, { width: number; height: number }>;

	constructor(sizes: Record<string, { width: number; height: number }>) {
		this.sizes = new Map(Object.entries(sizes));
	}

	measureImage(src: string): { width: number; height: number } {
		const dims = this.sizes.get(src);
		if (!dims) {
			throw new Error(`ImageSizeAdapter: no dimensions registered for ${JSON.stringify(src)}`);
		}
		return { width: dims.width, height: dims.height };
	}
}

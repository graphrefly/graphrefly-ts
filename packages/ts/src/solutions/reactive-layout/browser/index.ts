import type { MeasurementAdapter } from "../index.js";

interface CanvasTextContextLike {
	readonly measureText: (text: string) => { readonly width: number };
	font: string;
}

interface OffscreenCanvasLike {
	getContext(type: "2d"): CanvasTextContextLike | null;
}

interface OffscreenCanvasConstructor {
	new (width: number, height: number): OffscreenCanvasLike;
}

interface CanvasMeasureAdapterOptions {
	readonly emojiCorrection?: number;
}

/**
 * Browser measurement adapter using OffscreenCanvas.
 *
 * Lazily creates one OffscreenCanvas + 2D context when first measured.
 */
export class CanvasMeasureAdapter implements MeasurementAdapter {
	private ctx: CanvasTextContextLike | null = null;
	private currentFont = "";
	private readonly emojiCorrection: number;

	constructor(opts?: CanvasMeasureAdapterOptions) {
		this.emojiCorrection = opts?.emojiCorrection ?? 1;
	}

	private getContext(): CanvasTextContextLike {
		if (this.ctx !== null) return this.ctx;
		const globalOffscreenCanvas = (
			globalThis as { OffscreenCanvas?: OffscreenCanvasConstructor | undefined }
		).OffscreenCanvas;
		if (typeof globalOffscreenCanvas === "undefined") {
			throw new TypeError("CanvasMeasureAdapter requires a browser with OffscreenCanvas support");
		}
		const canvas = new globalOffscreenCanvas(0, 0);
		const ctx = canvas.getContext("2d");
		if (ctx === null) throw new TypeError("CanvasMeasureAdapter: failed to get 2D context");
		this.ctx = ctx;
		return ctx;
	}

	measureSegment(text: string, font: string): { readonly width: number } {
		const ctx = this.getContext();
		if (font !== this.currentFont) {
			ctx.font = font;
			this.currentFont = font;
		}
		let width = ctx.measureText(text).width;
		if (this.emojiCorrection !== 1 && /\p{Emoji_Presentation}/u.test(text)) {
			width *= this.emojiCorrection;
		}
		return { width };
	}

	clearCache(): void {
		this.currentFont = "";
	}
}

import type { Graph } from "../../../graph/graph.js";
import type { Node } from "../../../node/node.js";
import {
	type MeasurementAdapter,
	type Measurements,
	type SegmentAdapter,
	textMeasurementProvider,
} from "../index.js";

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

/** Browser-only Canvas text measurement options. */
export interface CanvasMeasureAdapterOptions {
	/** Multiplier applied only to emoji-presentation segments. Default: 1. */
	readonly emojiCorrection?: number;
}

/** Browser Canvas text measurement provider options. */
export interface CanvasTextMeasurementsOptions extends CanvasMeasureAdapterOptions {
	readonly graph: Graph;
	readonly text: Node<string>;
	readonly font: Node<string>;
	readonly segmentAdapter?: Node<SegmentAdapter>;
	readonly targetId?: string;
	readonly source?: string;
	readonly name?: string;
}

/**
 * Browser measurement adapter using OffscreenCanvas.
 *
 * Lazily creates one OffscreenCanvas + 2D context when first measured.
 * @category solutions
 * @example
 * ```ts
 * import { CanvasMeasureAdapter } from "@graphrefly/ts/solutions/reactive-layout/browser";
 * ```
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

/** Browser provider helper that emits graph-visible Canvas text measurement facts.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { canvasTextMeasurements } from "@graphrefly/ts/solutions/reactive-layout/browser";
 * ```
 */
export function canvasTextMeasurements(opts: CanvasTextMeasurementsOptions): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.state<MeasurementAdapter>(
		new CanvasMeasureAdapter({ emojiCorrection: opts.emojiCorrection }),
		{
			name: opts.name ? `${opts.name}:measure-capability` : `${targetId}-canvas-measure-capability`,
		},
	);
	return textMeasurementProvider({
		graph: opts.graph,
		text: opts.text,
		font: opts.font,
		adapter,
		segmentAdapter: opts.segmentAdapter,
		targetId: opts.targetId,
		source: opts.source ?? "canvasTextMeasurements",
		name: opts.name,
	});
}

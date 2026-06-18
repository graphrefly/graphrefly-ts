import type { Ctx } from "../../ctx/types.js";
import { errorPayload } from "../../protocol/messages.js";
import type { MeasureBlockOptions, MeasurementAdapter, Size } from "./types.js";

export function nonNegativeFinite(value: number, fallback: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function finiteNumber(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

export function emitLayoutError(ctx: Ctx, error: unknown, fallback: string): void {
	ctx.down([["ERROR", errorPayload(error, fallback)]]);
}

export function positiveFinite(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clampDimension(value: number | undefined): number {
	return nonNegativeFinite(value ?? 0, 0);
}

export function fitSize(size: Size, maxWidth: number): Size {
	const width = nonNegativeFinite(size.width, 0);
	const height = nonNegativeFinite(size.height, 0);
	if (width === 0 || maxWidth <= 0 || width <= maxWidth) return { width, height };
	const scale = maxWidth / width;
	return { width: maxWidth, height: height * scale };
}

export function blockMaxWidth(blockMaxWidth: number | undefined, maxWidth: number): number {
	const own = blockMaxWidth === undefined ? maxWidth : nonNegativeFinite(blockMaxWidth, maxWidth);
	if (maxWidth <= 0) return own;
	if (own <= 0) return maxWidth;
	return Math.min(own, maxWidth);
}

export function resolveTextAdapter(opts: MeasureBlockOptions): MeasurementAdapter {
	const adapter = opts.adapters?.text ?? opts.adapter;
	if (!adapter) throw new Error("Text blocks require a MeasurementAdapter");
	return adapter;
}

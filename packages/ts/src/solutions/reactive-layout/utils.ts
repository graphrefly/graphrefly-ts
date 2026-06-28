import type { Ctx } from "../../ctx/types.js";
import { errorPayload } from "../../protocol/messages.js";
import type { MeasureBlockOptions, MeasurementAdapter, Size } from "./types.js";

/**
 * Clamp a value to a finite, non-negative number.
 *
 * @param value - Input value.
 * @param fallback - Value used when input is not finite.
 * @returns A finite, non-negative number.
 * @example
 * ```ts
 * nonNegativeFinite(-2, 0);
 * ```
 * @category reactive-layout
 */
export function nonNegativeFinite(value: number, fallback: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/**
 * Clamp a value to a finite number.
 *
 * @param value - Input value.
 * @param fallback - Value used when input is not finite.
 * @returns A finite number.
 * @example
 * ```ts
 * finiteNumber(Number.NaN, 0);
 * ```
 * @category reactive-layout
 */
export function finiteNumber(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

/**
 * Emit a layout error through the graph protocol.
 *
 * @param ctx - Current fn context.
 * @param error - Error payload to normalize.
 * @param fallback - Fallback message used for invalid payloads.
 * @returns Nothing; the error is emitted via `ctx.down`.
 * @example
 * ```ts
 * emitLayoutError(ctx, new Error("bad layout"), "layout failed");
 * ```
 * @category reactive-layout
 */
export function emitLayoutError(ctx: Ctx, error: unknown, fallback: string): void {
	ctx.down([["ERROR", errorPayload(error, fallback)]]);
}

/**
 * Clamp a value to a finite positive number.
 *
 * @param value - Input value.
 * @param fallback - Value used when input is not finite or non-positive.
 * @returns A finite, positive number.
 * @example
 * ```ts
 * positiveFinite(0, 12);
 * ```
 * @category reactive-layout
 */
export function positiveFinite(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Clamp an optional dimension to a finite, non-negative number.
 *
 * @param value - Optional dimension.
 * @returns A non-negative dimension.
 * @example
 * ```ts
 * clampDimension(undefined);
 * ```
 * @category reactive-layout
 */
export function clampDimension(value: number | undefined): number {
	return nonNegativeFinite(value ?? 0, 0);
}

/**
 * Fit a size within a maximum width while preserving aspect ratio.
 *
 * @param size - Input size.
 * @param maxWidth - Maximum width constraint.
 * @returns The fitted size.
 * @example
 * ```ts
 * fitSize({ width: 200, height: 100 }, 50);
 * ```
 * @category reactive-layout
 */
export function fitSize(size: Size, maxWidth: number): Size {
	const width = nonNegativeFinite(size.width, 0);
	const height = nonNegativeFinite(size.height, 0);
	if (width === 0 || maxWidth <= 0 || width <= maxWidth) return { width, height };
	const scale = maxWidth / width;
	return { width: maxWidth, height: height * scale };
}

/**
 * Resolve the effective maximum width for a block.
 *
 * @param blockMaxWidth - Block-specific maximum width.
 * @param maxWidth - Layout-wide maximum width.
 * @returns The tighter width constraint.
 * @example
 * ```ts
 * blockMaxWidth(120, 80);
 * ```
 * @category reactive-layout
 */
export function blockMaxWidth(blockMaxWidth: number | undefined, maxWidth: number): number {
	const own = blockMaxWidth === undefined ? maxWidth : nonNegativeFinite(blockMaxWidth, maxWidth);
	if (maxWidth <= 0) return own;
	if (own <= 0) return maxWidth;
	return Math.min(own, maxWidth);
}

/**
 * Resolve the text measurement adapter from block measurement options.
 *
 * @param opts - Block measurement options.
 * @returns The selected text measurement adapter.
 * @example
 * ```ts
 * resolveTextAdapter({ adapter });
 * ```
 * @category reactive-layout
 */
export function resolveTextAdapter(opts: MeasureBlockOptions): MeasurementAdapter {
	const adapter = opts.adapters?.text ?? opts.adapter;
	if (!adapter) throw new Error("Text blocks require a MeasurementAdapter");
	return adapter;
}

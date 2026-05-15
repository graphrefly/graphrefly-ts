import {
	CanvasMeasureAdapter,
	type MeasurementAdapter,
} from "@graphrefly/graphrefly/utils/reactive-layout";

export const LAYOUT_FONT = '14px "Fira Code", ui-monospace, monospace';
export const LAYOUT_LINE_HEIGHT = 22;

let adapter: MeasurementAdapter | null = null;

/**
 * Lazy singleton. `OffscreenCanvas` reuse across every chapter/bundle keeps
 * font-switching cheap and the measurement cache warm — the main argument
 * this demo exists to make.
 *
 * **Cache footprint.** `CanvasMeasureAdapter` itself doesn't cache segment
 * widths — it just holds the current font and delegates to
 * `ctx.measureText()` on every call. The real `measureCache` lives inside
 * each `reactiveLayout` bundle (a `Map<font, Map<segment, width>>`). That
 * map is flushed by core whenever the bundle's `segments` node is
 * invalidated (function-form cleanup on INVALIDATE) and otherwise grows
 * bounded by the unique (font, segment) combinations the user has
 * entered in this session. For the five-chapter demo that's a few
 * hundred entries at most — well under a megabyte. Long-lived prod
 * consumers that don't reload should add an LRU cap in
 * `reactive-layout.ts` rather than here.
 */
export function getMeasurementAdapter(): MeasurementAdapter {
	if (!adapter) adapter = new CanvasMeasureAdapter();
	return adapter;
}

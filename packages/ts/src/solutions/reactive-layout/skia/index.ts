import type { Node } from "../../../node/node.js";
import {
	type CapabilityTextMeasurementsOptions,
	capabilityTextMeasurements,
	type Measurements,
	type TextMeasureCapability,
} from "../index.js";

/** Caller-owned synchronous Skia text capability. */
export interface SkiaTextMeasureCapability extends TextMeasureCapability {}

/** Dependency-free Skia focused subpath options. */
export interface SkiaTextMeasurementsOptions
	extends Omit<CapabilityTextMeasurementsOptions, "capability"> {
	readonly capability: Node<SkiaTextMeasureCapability>;
}

/**
 * Skia provider helper for caller-injected synchronous text measurement.
 *
 * This subpath does not import a Skia package; hosts expose the capability as graph data.
 */
export function skiaTextMeasurements(opts: SkiaTextMeasurementsOptions): Node<Measurements> {
	return capabilityTextMeasurements({
		...opts,
		source: opts.source ?? "skiaTextMeasurements",
	});
}

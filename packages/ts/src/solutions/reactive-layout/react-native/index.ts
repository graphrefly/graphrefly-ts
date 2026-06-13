import type { Node } from "../../../node/node.js";
import {
	type CapabilityTextMeasurementsOptions,
	capabilityTextMeasurements,
	type Measurements,
	type TextMeasureCapability,
} from "../index.js";

/** Caller-owned synchronous React Native text capability. */
export interface ReactNativeTextMeasureCapability extends TextMeasureCapability {}

/** Dependency-free React Native focused subpath options. */
export interface ReactNativeTextMeasurementsOptions
	extends Omit<CapabilityTextMeasurementsOptions, "capability"> {
	readonly capability: Node<ReactNativeTextMeasureCapability>;
}

/**
 * React Native provider helper for caller-injected synchronous text measurement.
 *
 * Async native readiness or layout probes should enter the graph as explicit facts upstream.
 */
export function reactNativeTextMeasurements(
	opts: ReactNativeTextMeasurementsOptions,
): Node<Measurements> {
	return capabilityTextMeasurements({
		...opts,
		source: opts.source ?? "reactNativeTextMeasurements",
	});
}

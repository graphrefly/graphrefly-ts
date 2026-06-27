import { type Ctx, depLatest } from "../../../ctx/types.js";
import type { Graph } from "../../../graph/graph.js";
import type { Node } from "../../../node/node.js";
import {
	type CapabilityTextMeasurementsOptions,
	capabilityTextMeasurements,
	type MeasurementFact,
	type MeasurementIssue,
	type MeasurementResult,
	type Measurements,
	type Size,
	type TextMeasureCapability,
} from "../index.js";

/** Caller-owned synchronous React Native text capability. */
export interface ReactNativeTextMeasureCapability extends TextMeasureCapability {}

export const REACT_NATIVE_LAYOUT_MEASUREMENT_KIND = "react-native-layout";

/** Dependency-free React Native focused subpath options. */
export interface ReactNativeTextMeasurementsOptions
	extends Omit<CapabilityTextMeasurementsOptions, "capability"> {
	readonly capability: Node<ReactNativeTextMeasureCapability>;
}

/** One async onLayout/native-probe fact supplied by a React Native host. */
export interface ReactNativeLayoutProbe {
	readonly id?: string;
	readonly width?: number;
	readonly height?: number;
	readonly ready?: boolean;
	readonly code?: string;
	readonly message?: string;
	readonly source?: string;
	readonly details?: unknown;
	readonly metadata?: Record<string, unknown>;
}

export interface ReactNativeLayoutMeasurementsOptions {
	readonly graph: Graph;
	readonly probes: Node<readonly ReactNativeLayoutProbe[]>;
	readonly measurementKind?: string;
	readonly source?: string;
	readonly name?: string;
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

function validLayoutSize(probe: ReactNativeLayoutProbe): Size | null {
	const width = probe.width;
	const height = probe.height;
	if (
		typeof width !== "number" ||
		typeof height !== "number" ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width < 0 ||
		height < 0
	) {
		return null;
	}
	return { width, height };
}

function reactNativeMeasurementIssue(
	probe: ReactNativeLayoutProbe | undefined,
	index: number,
	subjectId: string,
	measurementKind: string,
	source: string,
): MeasurementIssue {
	return {
		kind: "issue",
		code: probe?.code ?? "measurement.react-native-layout.pending",
		message: probe?.message ?? `React Native layout measurement is not ready for '${subjectId}'`,
		severity: probe?.ready === false ? "warning" : "error",
		source: probe?.source ?? source,
		subjectId,
		measurementKind,
		details: probe?.details ?? { index },
		metadata: probe?.metadata,
	};
}

/**
 * Project React Native onLayout/native-probe results into measurement facts.
 *
 * The async probe mechanism lives outside GraphReFly; this helper only consumes the latest probe
 * facts as declared graph data and never pretends RN core measurement is synchronous.
 */
export function reactNativeLayoutMeasurements(
	opts: ReactNativeLayoutMeasurementsOptions,
): Node<Measurements> {
	const measurementKind = opts.measurementKind ?? REACT_NATIVE_LAYOUT_MEASUREMENT_KIND;
	const source = opts.source ?? "reactNativeLayoutMeasurements";
	return opts.graph.node<Measurements>(
		[opts.probes],
		(ctx: Ctx) => {
			const probes = depLatest(ctx, 0) as readonly ReactNativeLayoutProbe[];
			const facts: MeasurementFact<Size>[] = [];
			for (let i = 0; i < probes.length; i += 1) {
				const probe = (probes as readonly (ReactNativeLayoutProbe | undefined)[])[i];
				const subjectId = probe?.id ?? `react-native-layout:${i}`;
				const size = probe && probe.ready !== false ? validLayoutSize(probe) : null;
				if (probe && size) {
					const ok: MeasurementResult<Size> = {
						kind: "ok",
						targetId: subjectId,
						measurementKind,
						value: size,
						source: probe.source ?? source,
						metadata: probe.metadata,
					};
					facts.push(ok);
				} else {
					facts.push(reactNativeMeasurementIssue(probe, i, subjectId, measurementKind, source));
				}
			}
			ctx.down([["DATA", facts]]);
		},
		{ name: opts.name ?? "react-native-layout-measurements" },
	);
}

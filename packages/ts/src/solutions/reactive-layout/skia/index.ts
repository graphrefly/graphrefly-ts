import { depLatest } from "../../../ctx/types.js";
import type { Node } from "../../../node/node.js";
import {
	CapabilityMeasureAdapter,
	type CapabilityTextMeasurementsOptions,
	capabilityTextMeasurements,
	type MeasurementAdapter,
	type MeasurementReadiness,
	type Measurements,
	readinessTextMeasurements,
	type TextMeasureCapability,
} from "../index.js";

/** Caller-owned synchronous Skia text capability. */
export interface SkiaTextMeasureCapability extends TextMeasureCapability {}

export interface SkiaParagraphLike {
	layout(width: number): void;
	getLongestLine(): number;
}

export interface SkiaParagraphBuilderLike {
	pushStyle?(style: unknown): SkiaParagraphBuilderLike;
	addText(text: string): SkiaParagraphBuilderLike;
	pop?(): SkiaParagraphBuilderLike;
	build(): SkiaParagraphLike;
}

export interface SkiaParagraphBuilderFactoryLike {
	Make(paragraphStyle?: unknown, fontManager?: unknown): SkiaParagraphBuilderLike;
}

export interface SkiaParagraphRuntimeLike {
	readonly ParagraphBuilder: SkiaParagraphBuilderFactoryLike;
}

export interface SkiaParagraphTextCapabilityOptions {
	readonly Skia: SkiaParagraphRuntimeLike;
	readonly fontManager?: unknown;
	readonly paragraphStyle?: unknown;
	readonly textStyle?: unknown;
	readonly textStyleForFont?: (font: string) => unknown;
	readonly layoutWidth?: number;
}

/** Dependency-free Skia focused subpath options. */
export interface SkiaTextMeasurementsOptions
	extends Omit<CapabilityTextMeasurementsOptions, "capability"> {
	readonly capability: Node<SkiaTextMeasureCapability>;
}

export interface SkiaReadyTextMeasurementsOptions extends SkiaTextMeasurementsOptions {
	readonly readiness: Node<MeasurementReadiness>;
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

/**
 * Build a synchronous Skia Paragraph-backed text capability from an already-ready runtime.
 *
 * Hosts should load fonts first (for example with React Native Skia `useFonts`, which returns
 * null until ready) and pass explicit readiness facts to `skiaReadyTextMeasurements`.
 */
export function skiaParagraphTextMeasureCapability(
	opts: SkiaParagraphTextCapabilityOptions,
): SkiaTextMeasureCapability {
	const layoutWidth = opts.layoutWidth ?? Number.MAX_SAFE_INTEGER;
	return {
		measureText(text: string, font: string): { readonly width: number } {
			const builder = opts.Skia.ParagraphBuilder.Make(opts.paragraphStyle ?? {}, opts.fontManager);
			const style = opts.textStyleForFont?.(font) ?? opts.textStyle;
			if (style !== undefined && builder.pushStyle) {
				builder.pushStyle(style);
			}
			builder.addText(text);
			if (style !== undefined && builder.pop) {
				builder.pop();
			}
			const paragraph = builder.build();
			paragraph.layout(layoutWidth);
			return { width: paragraph.getLongestLine() };
		},
	};
}

/**
 * Skia provider helper that refuses to measure until caller-supplied font/runtime readiness is DATA.
 *
 * This does not load fonts or create a Skia runtime; readiness is an explicit graph input.
 */
export function skiaReadyTextMeasurements(
	opts: SkiaReadyTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.node<MeasurementAdapter>(
		[opts.capability],
		(ctx) => {
			ctx.down([
				["DATA", new CapabilityMeasureAdapter(depLatest(ctx, 0) as SkiaTextMeasureCapability)],
			]);
		},
		{
			name: opts.name ? `${opts.name}:measure-capability` : `${targetId}-measure-capability`,
		},
	);
	return readinessTextMeasurements({
		graph: opts.graph,
		text: opts.text,
		font: opts.font,
		adapter,
		readiness: opts.readiness,
		segmentAdapter: opts.segmentAdapter,
		targetId: opts.targetId,
		source: opts.source ?? "skiaReadyTextMeasurements",
		name: opts.name,
	});
}

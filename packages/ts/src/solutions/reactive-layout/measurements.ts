import { type Ctx, depLatest } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph, StateNode } from "../../graph/graph.js";
import { Node } from "../../node/node.js";
import {
	CapabilityMeasureAdapter,
	CellMeasureAdapter,
	InjectedMeasureAdapter,
	PrecomputedMeasureAdapter,
} from "./adapters.js";
import { measureBlock } from "./block.js";
import { analyzeAndMeasure } from "./line.js";
import { getDefaultSegmentAdapter } from "./segment.js";
import type {
	BlockAdapters,
	BlockAdaptersProviderOptions,
	BlockMeasurementProviderOptions,
	BlocksMeasurement,
	CapabilityTextMeasurementsOptions,
	CellTextMeasurementsOptions,
	ContentBlock,
	ImageMeasurer,
	ImageSizeMeasurementsOptions,
	ImageSizeMeasurementTarget,
	InjectedTextMeasurementsOptions,
	MeasuredBlock,
	MeasurementAdapter,
	MeasurementFact,
	MeasurementIssue,
	MeasurementReadiness,
	MeasurementResult,
	Measurements,
	MergeMeasurementsOptions,
	PrecomputedTextMeasurementsOptions,
	ReadinessMeasurementsOptions,
	ReadinessTextMeasurementsOptions,
	SegmentAdapter,
	Size,
	SvgBoundsMeasurementsOptions,
	SvgBoundsMeasurementTarget,
	SvgMeasurer,
	TextMeasureCapability,
	TextMeasurementProviderOptions,
	TextSegmentsMeasurement,
} from "./types.js";
import {
	BLOCKS_MEASUREMENT_KIND,
	IMAGE_SIZE_MEASUREMENT_KIND,
	READINESS_MEASUREMENT_KIND,
	SVG_BOUNDS_MEASUREMENT_KIND,
	TEXT_SEGMENTS_MEASUREMENT_KIND,
} from "./types.js";
import { nonNegativeFinite } from "./utils.js";

/**
 * Create a measurement issue fact.
 *
 * @param code - Stable issue code.
 * @param message - Human-readable issue message.
 * @param targetId - Measurement target id.
 * @param measurementKind - Measurement kind tag.
 * @param opts - Optional source, severity, details, and metadata.
 * @returns A measurement issue fact.
 * @example
 * ```ts
 * measurementIssue("measurement.failed", "Text measurement failed", "title", "text-segments");
 * ```
 * @category reactive-layout
 */
export function measurementIssue(
	code: string,
	message: string,
	targetId: string,
	measurementKind: string,
	opts: {
		readonly source?: string;
		readonly details?: unknown;
		readonly metadata?: Record<string, unknown>;
		readonly severity?: DataIssue["severity"];
	} = {},
): MeasurementIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: opts.severity ?? "warning",
		source: opts.source,
		subjectId: targetId,
		measurementKind,
		details: opts.details,
		metadata: opts.metadata,
	};
}

/**
 * Create a successful measurement fact.
 *
 * @param targetId - Measurement target id.
 * @param measurementKind - Measurement kind tag.
 * @param value - Measured value.
 * @param opts - Optional source and metadata.
 * @returns A successful measurement fact.
 * @example
 * ```ts
 * measurementOk("title", "text-segments", { segments: [] });
 * ```
 * @category reactive-layout
 */
export function measurementOk<T>(
	targetId: string,
	measurementKind: string,
	value: T,
	opts: { readonly source?: string; readonly metadata?: Record<string, unknown> } = {},
): MeasurementResult<T> {
	return {
		kind: "ok",
		targetId,
		measurementKind,
		value,
		source: opts.source,
		metadata: opts.metadata,
	};
}

/**
 * Read the latest successful measurement value for a target/kind pair.
 *
 * @param measurements - Measurement fact list to scan.
 * @param targetId - Measurement target id.
 * @param measurementKind - Measurement kind tag.
 * @returns The latest matching successful value, or `undefined`.
 * @example
 * ```ts
 * latestMeasurementValue(measurements, "title", "text-segments");
 * ```
 * @category reactive-layout
 */
export function latestMeasurementValue<T>(
	measurements: Measurements,
	targetId: string,
	measurementKind: string,
): T | undefined {
	let value: T | undefined;
	for (const fact of measurements) {
		if (
			fact.kind === "ok" &&
			fact.targetId === targetId &&
			fact.measurementKind === measurementKind
		) {
			value = fact.value as T;
		}
	}
	return value;
}

/**
 * Measure hyphen width when the adapter supports it.
 *
 * @param adapter - Measurement adapter to query.
 * @param font - Font string passed to the adapter.
 * @returns The hyphen width, or `undefined` when measurement fails.
 * @example
 * ```ts
 * tryMeasureHyphenWidth(adapter, "16px sans-serif");
 * ```
 * @category reactive-layout
 */
export function tryMeasureHyphenWidth(
	adapter: MeasurementAdapter,
	font: string,
): number | undefined {
	try {
		return nonNegativeFinite(adapter.measureSegment("-", font).width, 0);
	} catch {
		return undefined;
	}
}

/**
 * Validate a size record for measurement output.
 *
 * @param size - Size to validate.
 * @param label - Label used in the error message.
 * @returns The validated size.
 * @example
 * ```ts
 * validMeasurementSize({ width: 10, height: 20 }, "image");
 * ```
 * @category reactive-layout
 */
export function validMeasurementSize(size: Size, label: string): Size {
	if (
		!Number.isFinite(size.width) ||
		!Number.isFinite(size.height) ||
		size.width < 0 ||
		size.height < 0
	) {
		throw new Error(`Invalid ${label} measurement size`);
	}
	return size;
}

/**
 * Measure text and package the result as measurement facts.
 *
 * @param text - Text to measure.
 * @param font - Font string to measure with.
 * @param adapter - Measurement adapter.
 * @param cache - Shared segment measurement cache.
 * @param segmentAdapter - Segment adapter used for grapheme/word splitting.
 * @param targetId - Measurement target id.
 * @param source - Measurement source label.
 * @returns Measurement facts describing the text segments and hyphen width.
 * @example
 * ```ts
 * textMeasurementFacts("Hello", "16px sans-serif", adapter, new Map(), segmentAdapter, "title", "demo");
 * ```
 * @category reactive-layout
 */
export function textMeasurementFacts(
	text: string,
	font: string,
	adapter: MeasurementAdapter,
	cache: Map<string, Map<string, number>>,
	segmentAdapter: SegmentAdapter,
	targetId: string,
	source: string,
): Measurements {
	try {
		const segments = analyzeAndMeasure(text, font, adapter, cache, undefined, segmentAdapter);
		const hyphenWidth = tryMeasureHyphenWidth(adapter, font);
		const facts: MeasurementFact<TextSegmentsMeasurement>[] = [
			measurementOk<TextSegmentsMeasurement>(
				targetId,
				TEXT_SEGMENTS_MEASUREMENT_KIND,
				hyphenWidth === undefined ? { segments } : { segments, hyphenWidth },
				{ source },
			),
		];
		if (hyphenWidth === undefined) {
			facts.push(
				measurementIssue(
					"measurement.hyphen.failed",
					`Hyphen measurement failed for '${targetId}'`,
					targetId,
					TEXT_SEGMENTS_MEASUREMENT_KIND,
					{ source, severity: "warning" },
				),
			);
		}
		return facts;
	} catch (error) {
		return [
			measurementIssue(
				"measurement.failed",
				`Text measurement failed for '${targetId}'`,
				targetId,
				TEXT_SEGMENTS_MEASUREMENT_KIND,
				{ source, details: error, severity: "error" },
			),
		];
	}
}

/**
 * Wrap a direct value or state node into a writable node handle.
 *
 * @param g - Graph that owns the writable state fallback.
 * @param input - Existing node or raw initial value.
 * @param fallback - Fallback value when input is absent.
 * @param name - Name used for the generated state node.
 * @returns The node plus a setter that updates the backing state.
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 * import { inputNode } from "@graphrefly/ts/solutions/reactive-layout";
 *
 * const g = graph();
 * inputNode(g, undefined, 0, "count");
 * ```
 * @category reactive-layout
 */
export function inputNode<T>(
	g: Graph,
	input: T | Node<T> | undefined,
	fallback: T,
	name: string,
): { readonly node: Node<T>; readonly set: (value: T) => void } {
	if (input instanceof Node) {
		return {
			node: input,
			set(value: T): void {
				const maybeState = input as Node<T> & { set?: (next: T) => void };
				if (typeof maybeState.set !== "function") {
					throw new TypeError(`reactive-layout input '${name}' is not a writable state node`);
				}
				maybeState.set(value);
			},
		};
	}
	const state: StateNode<T> = g.state(input ?? fallback, { name });
	return { node: state, set: (value: T) => state.set(value) };
}

/**
 * Build a scoped measurement name.
 *
 * @param scope - Scope prefix.
 * @param local - Local name.
 * @returns The scoped name, or `local` when already scoped.
 * @example
 * ```ts
 * scopedName("layout", "text");
 * ```
 * @category reactive-layout
 */
export function scopedName(scope: string, local: string): string {
	return scope === local ? local : `${scope}:${local}`;
}

/** Generic sync text measurement provider that emits graph-visible measurement facts.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { textMeasurementProvider } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function textMeasurementProvider(opts: TextMeasurementProviderOptions): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	const cache = new Map<string, Map<string, number>>();
	let activeAdapter: MeasurementAdapter | null = null;
	return opts.graph.node<Measurements>(
		opts.segmentAdapter
			? [opts.text, opts.font, opts.adapter, opts.segmentAdapter]
			: [opts.text, opts.font, opts.adapter],
		(ctx: Ctx) => {
			const flush = () => {
				cache.clear();
				(depLatest(ctx, 2) as MeasurementAdapter).clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			const text = depLatest(ctx, 0) as string;
			const font = depLatest(ctx, 1) as string;
			const adapter = depLatest(ctx, 2) as MeasurementAdapter;
			if (adapter !== activeAdapter) {
				cache.clear();
				activeAdapter = adapter;
			}
			const segmentAdapter =
				opts.segmentAdapter === undefined
					? getDefaultSegmentAdapter()
					: (depLatest(ctx, 3) as SegmentAdapter);
			ctx.down([
				[
					"DATA",
					textMeasurementFacts(text, font, adapter, cache, segmentAdapter, targetId, source),
				],
			]);
		},
		{ name },
	);
}

/** Provider helper for caller-injected synchronous text measurement.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { injectedTextMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function injectedTextMeasurements(
	opts: InjectedTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.state<MeasurementAdapter>(
		new InjectedMeasureAdapter(opts.measure, { cache: opts.cache }),
		{
			name: opts.name
				? scopedName(opts.name, "measure-capability")
				: `${targetId}-measure-capability`,
		},
	);
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "injectedTextMeasurements",
	});
}

/** Provider helper for deterministic precomputed text metrics.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { precomputedTextMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function precomputedTextMeasurements(
	opts: PrecomputedTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.state<MeasurementAdapter>(new PrecomputedMeasureAdapter(opts), {
		name: opts.name
			? scopedName(opts.name, "measure-capability")
			: `${targetId}-measure-capability`,
	});
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "precomputedTextMeasurements",
	});
}

/** Provider helper for fixed-cell terminal/snapshot text measurement.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { cellTextMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function cellTextMeasurements(opts: CellTextMeasurementsOptions): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.state<MeasurementAdapter>(new CellMeasureAdapter(opts), {
		name: opts.name
			? scopedName(opts.name, "measure-capability")
			: `${targetId}-measure-capability`,
	});
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "cellTextMeasurements",
	});
}

/** Provider helper for caller-injected platform text capability nodes.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { capabilityTextMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function capabilityTextMeasurements(
	opts: CapabilityTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const adapter = opts.graph.node<MeasurementAdapter>(
		[opts.capability],
		(ctx: Ctx) => {
			ctx.down([
				["DATA", new CapabilityMeasureAdapter(depLatest(ctx, 0) as TextMeasureCapability)],
			]);
		},
		{
			name: opts.name
				? scopedName(opts.name, "measure-capability")
				: `${targetId}-measure-capability`,
		},
	);
	return textMeasurementProvider({
		...opts,
		adapter,
		source: opts.source ?? "capabilityTextMeasurements",
	});
}

/** Provider helper that makes readiness facts an explicit measurement dependency.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { readinessTextMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function readinessTextMeasurements(
	opts: ReadinessTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	const cache = new Map<string, Map<string, number>>();
	let activeAdapter: MeasurementAdapter | null = null;
	let activeReadiness: MeasurementReadiness | null = null;
	const deps = opts.segmentAdapter
		? [opts.text, opts.font, opts.adapter, opts.readiness, opts.segmentAdapter]
		: [opts.text, opts.font, opts.adapter, opts.readiness];
	return opts.graph.node<Measurements>(
		deps,
		(ctx: Ctx) => {
			const flush = () => {
				cache.clear();
				(depLatest(ctx, 2) as MeasurementAdapter).clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			const text = depLatest(ctx, 0) as string;
			const font = depLatest(ctx, 1) as string;
			const adapter = depLatest(ctx, 2) as MeasurementAdapter;
			if (adapter !== activeAdapter) {
				cache.clear();
				activeAdapter = adapter;
			}
			const readiness = depLatest(ctx, 3) as MeasurementReadiness;
			if (readiness !== activeReadiness) {
				cache.clear();
				activeReadiness = readiness;
			}
			if (!readiness.ready) {
				ctx.down([
					[
						"DATA",
						[
							measurementIssue(
								readiness.code ?? "measurement.not-ready",
								readiness.message ?? `Measurement readiness blocked '${targetId}'`,
								targetId,
								TEXT_SEGMENTS_MEASUREMENT_KIND,
								{
									source: readiness.source ?? source,
									details: readiness.details,
									metadata: readiness.metadata,
									severity: "warning",
								},
							),
						],
					],
				]);
				return;
			}
			const segmentAdapter =
				opts.segmentAdapter === undefined
					? getDefaultSegmentAdapter()
					: (depLatest(ctx, 4) as SegmentAdapter);
			ctx.down([
				[
					"DATA",
					textMeasurementFacts(text, font, adapter, cache, segmentAdapter, targetId, source),
				],
			]);
		},
		{ name },
	);
}

/** Provider helper that emits graph-visible readiness facts without measuring layout.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { readinessMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function readinessMeasurements(opts: ReadinessMeasurementsOptions): Node<Measurements> {
	const targetId = opts.targetId ?? "measurement-readiness";
	const measurementKind = opts.measurementKind ?? READINESS_MEASUREMENT_KIND;
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	return opts.graph.node<Measurements>(
		[opts.readiness],
		(ctx: Ctx) => {
			const readiness = depLatest(ctx, 0) as MeasurementReadiness;
			if (!readiness.ready) {
				ctx.down([
					[
						"DATA",
						[
							measurementIssue(
								readiness.code ?? "measurement.not-ready",
								readiness.message ?? `Measurement readiness blocked '${targetId}'`,
								targetId,
								measurementKind,
								{
									source: readiness.source ?? source,
									details: readiness.details,
									metadata: readiness.metadata,
									severity: "warning",
								},
							),
						],
					],
				]);
				return;
			}
			ctx.down([
				[
					"DATA",
					[
						measurementOk<MeasurementReadiness>(targetId, measurementKind, readiness, {
							source: readiness.source ?? source,
							metadata: readiness.metadata,
						}),
					],
				],
			]);
		},
		{ name },
	);
}

/** Provider helper for image-size facts from caller-owned synchronous image measurers.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { imageSizeMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function imageSizeMeasurements(opts: ImageSizeMeasurementsOptions): Node<Measurements> {
	const measurementKind = opts.measurementKind ?? IMAGE_SIZE_MEASUREMENT_KIND;
	const name = opts.name ?? "image-size-measurements";
	const source = opts.source ?? name;
	return opts.graph.node<Measurements>(
		[opts.images, opts.measurer],
		(ctx: Ctx) => {
			const images = depLatest(ctx, 0) as readonly ImageSizeMeasurementTarget[];
			const measurer = depLatest(ctx, 1) as ImageMeasurer;
			const facts: MeasurementFact<Size>[] = [];
			for (let i = 0; i < images.length; i += 1) {
				const image = (images as readonly (ImageSizeMeasurementTarget | undefined)[])[i];
				const subjectId = image?.id ?? image?.src ?? `image:${i}`;
				try {
					if (image === undefined) throw new Error(`Missing image target at index ${i}`);
					facts.push(
						measurementOk<Size>(
							subjectId,
							measurementKind,
							validMeasurementSize(measurer.measureImage(image.src), "image"),
							{
								source,
								metadata: image.metadata,
							},
						),
					);
				} catch (error) {
					facts.push(
						measurementIssue(
							"measurement.image-size.failed",
							`Image size measurement failed for '${subjectId}'`,
							subjectId,
							measurementKind,
							{
								source,
								details: { error, index: i, src: image?.src },
								metadata: image?.metadata,
								severity: "error",
							},
						),
					);
				}
			}
			ctx.down([["DATA", facts]]);
		},
		{ name },
	);
}

/** Provider helper for SVG bounds facts from caller-owned synchronous SVG measurers.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { svgBoundsMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function svgBoundsMeasurements(opts: SvgBoundsMeasurementsOptions): Node<Measurements> {
	const measurementKind = opts.measurementKind ?? SVG_BOUNDS_MEASUREMENT_KIND;
	const name = opts.name ?? "svg-bounds-measurements";
	const source = opts.source ?? name;
	return opts.graph.node<Measurements>(
		[opts.svgs, opts.measurer],
		(ctx: Ctx) => {
			const svgs = depLatest(ctx, 0) as readonly SvgBoundsMeasurementTarget[];
			const measurer = depLatest(ctx, 1) as SvgMeasurer;
			const facts: MeasurementFact<Size>[] = [];
			for (let i = 0; i < svgs.length; i += 1) {
				const svg = (svgs as readonly (SvgBoundsMeasurementTarget | undefined)[])[i];
				const subjectId = svg?.id ?? `svg:${i}`;
				try {
					if (svg === undefined) throw new Error(`Missing SVG target at index ${i}`);
					facts.push(
						measurementOk<Size>(
							subjectId,
							measurementKind,
							validMeasurementSize(measurer.measureSvg(svg.svg), "SVG"),
							{
								source,
								metadata: svg.metadata,
							},
						),
					);
				} catch (error) {
					facts.push(
						measurementIssue(
							"measurement.svg-bounds.failed",
							`SVG bounds measurement failed for '${subjectId}'`,
							subjectId,
							measurementKind,
							{
								source,
								details: { error, index: i },
								metadata: svg?.metadata,
								severity: "error",
							},
						),
					);
				}
			}
			ctx.down([["DATA", facts]]);
		},
		{ name },
	);
}

/** Merge provider fact nodes into the single measurements node consumed by layout bundles.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { mergeMeasurements } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function mergeMeasurements(opts: MergeMeasurementsOptions): Node<Measurements> {
	const sources = [...opts.sources];
	return opts.graph.node<Measurements>(
		sources as readonly Node<unknown>[],
		(ctx: Ctx) => {
			const facts: MeasurementFact[] = [];
			for (let i = 0; i < sources.length; i += 1) {
				facts.push(...(depLatest(ctx, i) as Measurements));
			}
			ctx.down([["DATA", facts]]);
		},
		{ name: opts.name ?? "measurements" },
	);
}

/** Compose optional block measurement capability nodes into one graph-visible adapter node.
 * @param opts - Options that configure the helper.
 * @returns A `Node<BlockAdapters>` value.
 * @category solutions
 * @example
 * ```ts
 * import { blockAdaptersProvider } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function blockAdaptersProvider(opts: BlockAdaptersProviderOptions): Node<BlockAdapters> {
	const deps: Node<unknown>[] = [];
	const positions: { text?: number; svg?: number; image?: number } = {};
	if (opts.text) {
		positions.text = deps.length;
		deps.push(opts.text);
	}
	if (opts.svg) {
		positions.svg = deps.length;
		deps.push(opts.svg);
	}
	if (opts.image) {
		positions.image = deps.length;
		deps.push(opts.image);
	}
	return opts.graph.node<BlockAdapters>(
		deps,
		(ctx: Ctx) => {
			const adapters: BlockAdapters = {
				text:
					positions.text === undefined
						? undefined
						: (depLatest(ctx, positions.text) as MeasurementAdapter),
				svg:
					positions.svg === undefined ? undefined : (depLatest(ctx, positions.svg) as SvgMeasurer),
				image:
					positions.image === undefined
						? undefined
						: (depLatest(ctx, positions.image) as ImageMeasurer),
			};
			ctx.down([["DATA", adapters]]);
		},
		{ name: opts.name ?? "block-adapters" },
	);
}

/** Provider helper for block measurement facts over declared block/max-width deps.
 * @param opts - Options that configure the helper.
 * @returns A `Node<Measurements>` value.
 * @category solutions
 * @example
 * ```ts
 * import { blockMeasurementProvider } from "@graphrefly/ts/solutions/reactive-layout";
 * ```
 */
export function blockMeasurementProvider(
	opts: BlockMeasurementProviderOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "blocks";
	const name = opts.name ?? `${targetId}-measurements`;
	const source = opts.source ?? name;
	const cache = new Map<string, Map<string, number>>();
	let activeTextAdapter: MeasurementAdapter | undefined;
	const deps = [opts.blocks, opts.maxWidth, opts.adapters] as Node<unknown>[];
	if (opts.font) deps.push(opts.font);
	if (opts.lineHeight) deps.push(opts.lineHeight);
	if (opts.segmentAdapter) deps.push(opts.segmentAdapter);
	return opts.graph.node<Measurements>(
		deps,
		(ctx: Ctx) => {
			const flush = () => {
				cache.clear();
				const adapters = depLatest(ctx, 2) as BlockAdapters;
				adapters.text?.clearCache?.();
			};
			ctx.onDeactivation(flush);
			ctx.onInvalidate(flush);
			try {
				const blocks = depLatest(ctx, 0) as readonly ContentBlock[];
				const maxWidth = nonNegativeFinite(depLatest(ctx, 1) as number, 0);
				const adapters = depLatest(ctx, 2) as BlockAdapters;
				if (adapters.text !== activeTextAdapter) {
					cache.clear();
					activeTextAdapter = adapters.text;
				}
				let depIndex = 3;
				const font = opts.font ? (depLatest(ctx, depIndex++) as string) : undefined;
				const lineHeight = opts.lineHeight
					? nonNegativeFinite(depLatest(ctx, depIndex++) as number, 0)
					: undefined;
				const segmentAdapter = opts.segmentAdapter
					? (depLatest(ctx, depIndex) as SegmentAdapter)
					: getDefaultSegmentAdapter();
				const measured: MeasuredBlock[] = [];
				const issues: MeasurementIssue[] = [];
				for (let i = 0; i < blocks.length; i += 1) {
					const block = (blocks as readonly (ContentBlock | undefined)[])[i];
					const subjectId = block?.id ?? `${targetId}:${i}`;
					try {
						if (block === undefined) {
							throw new Error(`Missing content block at index ${i}`);
						}
						const blockFont =
							block.kind === "text" ? (block.font ?? font ?? "16px sans-serif") : undefined;
						const hyphenWidth =
							block.kind === "text" && adapters.text
								? tryMeasureHyphenWidth(adapters.text, blockFont ?? "16px sans-serif")
								: undefined;
						measured.push(
							measureBlock(block, {
								adapters,
								font,
								hyphenWidth,
								lineHeight,
								maxWidth,
								cache,
								segmentAdapter,
							}),
						);
						if (block.kind === "text" && adapters.text) {
							if (hyphenWidth === undefined) {
								issues.push(
									measurementIssue(
										"measurement.hyphen.failed",
										`Hyphen measurement failed for '${subjectId}'`,
										subjectId,
										BLOCKS_MEASUREMENT_KIND,
										{
											source,
											details: { targetId, index: i },
											severity: "warning",
										},
									),
								);
							}
						}
					} catch (error) {
						issues.push(
							measurementIssue(
								"measurement.block.failed",
								`Block measurement failed for '${subjectId}'`,
								subjectId,
								BLOCKS_MEASUREMENT_KIND,
								{
									source,
									details: { error, targetId, index: i, blockKind: block?.kind },
									severity: "error",
								},
							),
						);
					}
				}
				ctx.down([
					[
						"DATA",
						[
							measurementOk<BlocksMeasurement>(
								targetId,
								BLOCKS_MEASUREMENT_KIND,
								{ blocks: measured },
								{ source },
							),
							...issues,
						],
					],
				]);
			} catch (error) {
				ctx.down([
					[
						"DATA",
						[
							measurementIssue(
								"measurement.failed",
								`Block measurement failed for '${targetId}'`,
								targetId,
								BLOCKS_MEASUREMENT_KIND,
								{ source, details: error, severity: "error" },
							),
						],
					],
				]);
			}
		},
		{ name },
	);
}

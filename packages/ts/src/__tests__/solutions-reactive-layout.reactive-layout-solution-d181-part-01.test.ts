import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { Message } from "../protocol/messages.js";
import {
	analyzeAndMeasure,
	type BlockAdapters,
	CellMeasureAdapter,
	capabilityTextMeasurements,
	carveTextLineSlots,
	cellTextMeasurements,
	computeCharPositions,
	computeLineBreaks,
	IMAGE_SIZE_MEASUREMENT_KIND,
	type ImageSizeMeasurementTarget,
	InjectedMeasureAdapter,
	imageSizeMeasurements,
	type LineBreaksResult,
	layoutNextLine,
	type MeasurementAdapter,
	type MeasurementReadiness,
	type MeasurementResult,
	type Measurements,
	PrecomputedMeasureAdapter,
	type PreparedSegment,
	precomputedTextMeasurements,
	READINESS_MEASUREMENT_KIND,
	reactiveLayout,
	readinessMeasurements,
	readinessTextMeasurements,
	SVG_BOUNDS_MEASUREMENT_KIND,
	SvgBoundsAdapter,
	type SvgBoundsMeasurementTarget,
	svgBoundsMeasurements,
	type TextMeasureCapability,
	type TextSegmentsMeasurement,
	textMeasurementProvider,
} from "../solutions/index.js";
import * as reactiveLayoutNodeCanvas from "../solutions/reactive-layout/node-canvas/index.js";
import * as reactiveLayoutReactNative from "../solutions/reactive-layout/react-native/index.js";
import * as reactiveLayoutSkia from "../solutions/reactive-layout/skia/index.js";

const fixedAdapter: MeasurementAdapter = {
	measureSegment(text) {
		return { width: Array.from(text).length * 10 };
	},
};

const fixedAdapters: BlockAdapters = { text: fixedAdapter };

const data = <T>(messages: readonly Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

function adapterNode(g: ReturnType<typeof graph>, name = "measure-capability") {
	return g.state<MeasurementAdapter>(fixedAdapter, { name });
}

function _blockAdaptersNode(g: ReturnType<typeof graph>, name = "block-adapters") {
	return g.state<BlockAdapters>(fixedAdapters, { name });
}

describe("reactive-layout solution (D181) — part 1", () => {
	it("prepares measured segments and computes greedy line breaks", () => {
		const cache = new Map<string, Map<string, number>>();
		const segments = analyzeAndMeasure("hello world", "test", fixedAdapter, cache);

		expectTypeOf(segments).toMatchTypeOf<PreparedSegment[]>();
		expect(segments.map((segment) => [segment.text, segment.kind, segment.width])).toEqual([
			["hello", "text", 50],
			[" ", "space", 10],
			["world", "text", 50],
		]);

		const breaks = computeLineBreaks(segments, 60);

		expectTypeOf(breaks).toMatchTypeOf<LineBreaksResult>();
		expect(breaks).toEqual({
			lineCount: 2,
			lines: [
				{
					text: "hello ",
					width: 50,
					startSegment: 0,
					startGrapheme: 0,
					endSegment: 2,
					endGrapheme: 0,
				},
				{
					text: "world",
					width: 50,
					startSegment: 2,
					startGrapheme: 0,
					endSegment: 3,
					endGrapheme: 0,
				},
			],
		});
	});

	it("preserves every grapheme when a single segment spans multiple lines", () => {
		const cache = new Map<string, Map<string, number>>();
		const segments = analyzeAndMeasure("abcdef", "test", fixedAdapter, cache);
		const breaks = computeLineBreaks(segments, 20);

		expect(breaks.lines.map((line) => line.text)).toEqual(["ab", "cd", "ef"]);
		expect(breaks.lines.map((line) => line.width)).toEqual([20, 20, 20]);
	});

	it("consumes hard breaks and continues after whole-word grapheme fallback", () => {
		const hardBreakCache = new Map<string, Map<string, number>>();
		const hardBreakSegments = analyzeAndMeasure("a\nb", "test", fixedAdapter, hardBreakCache);
		const hardBreaks = computeLineBreaks(hardBreakSegments, 20, {
			hyphenWidth: fixedAdapter.measureSegment("-", "test").width,
		});

		expect(hardBreaks.lines.map((line) => line.text)).toEqual(["a", "b"]);

		const kernedAdapter: MeasurementAdapter = {
			measureSegment(text) {
				return { width: text === "abcde" ? 100 : Array.from(text).length * 10 };
			},
		};
		const kernedCache = new Map<string, Map<string, number>>();
		const kernedSegments = analyzeAndMeasure("abcde f", "test", kernedAdapter, kernedCache);
		const kernedBreaks = computeLineBreaks(kernedSegments, 50, {
			hyphenWidth: kernedAdapter.measureSegment("-", "test").width,
		});

		expect(kernedBreaks.lines.map((line) => line.text)).toEqual(["abcde ", "f"]);
	});

	it("lays out the next line from a cursor and carves text slots", () => {
		const cache = new Map<string, Map<string, number>>();
		const segments = analyzeAndMeasure("abcd ef", "test", fixedAdapter, cache);

		expect(layoutNextLine(segments, { segmentIndex: 0, graphemeIndex: 0 }, 30)).toEqual({
			text: "abc",
			width: 30,
			start: { segmentIndex: 0, graphemeIndex: 0 },
			end: { segmentIndex: 0, graphemeIndex: 3 },
		});
		expect(carveTextLineSlots({ left: 0, right: 100 }, [{ left: 20, right: 40 }], 10)).toEqual([
			{ left: 0, right: 20 },
			{ left: 40, right: 100 },
		]);
	});

	it("computes per-grapheme positions from line breaks", () => {
		const cache = new Map<string, Map<string, number>>();
		const segments = analyzeAndMeasure("ab cd", "test", fixedAdapter, cache);
		const breaks = computeLineBreaks(segments, 30);

		expect(computeCharPositions(breaks, segments, 12)).toEqual([
			{ x: 0, y: 0, width: 10, height: 12, line: 0 },
			{ x: 10, y: 0, width: 10, height: 12, line: 0 },
			{ x: 20, y: 0, width: 10, height: 12, line: 0 },
			{ x: 0, y: 12, width: 10, height: 12, line: 1 },
			{ x: 10, y: 12, width: 10, height: 12, line: 1 },
		]);
	});

	it("builds a graph-visible reactiveLayout bundle without hidden subscribe islands", () => {
		const g = graph({ name: "reactive-layout" });
		const text = g.state("one two", { name: "text" });
		const font = g.state("test", { name: "font" });
		const measurements = textMeasurementProvider({
			graph: g,
			text,
			font,
			adapter: adapterNode(g),
		});
		const bundle = reactiveLayout({
			graph: g,
			measurements,
			lineHeight: 12,
			maxWidth: 40,
		});
		const breaks = collect(bundle.lineBreaks);
		const height = collect(bundle.height);
		const positions = collect(bundle.charPositions);

		expect(bundle.graph.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "text", to: "text-measurements" },
				{ from: "font", to: "text-measurements" },
				{ from: "measure-capability", to: "text-measurements" },
				{ from: "text-measurements", to: "reactive-layout:segments" },
				{ from: "reactive-layout:segments", to: "reactive-layout:line-breaks" },
				{ from: "reactive-layout:max-width", to: "reactive-layout:line-breaks" },
				{ from: "text-measurements", to: "reactive-layout:line-breaks" },
				{ from: "reactive-layout:line-breaks", to: "reactive-layout:height" },
				{ from: "reactive-layout:line-height", to: "reactive-layout:height" },
				{ from: "reactive-layout:line-breaks", to: "reactive-layout:char-positions" },
				{ from: "reactive-layout:segments", to: "reactive-layout:char-positions" },
				{ from: "reactive-layout:line-height", to: "reactive-layout:char-positions" },
			]),
		);

		bundle.setMaxWidth(30);

		expect(
			data<LineBreaksResult>(breaks.messages)
				.at(-1)
				?.lines.map((line) => line.text),
		).toEqual(["one ", "two"]);
		expect(data<number>(height.messages).at(-1)).toBe(24);
		expect(data<readonly unknown[]>(positions.messages).at(-1)?.length).toBe(7);

		breaks.unsubscribe();
		height.unsubscribe();
		positions.unsubscribe();
	});

	it("clamps non-finite and negative numeric controls", () => {
		const g = graph({ name: "reactive-layout" });
		const text = g.state("one", { name: "text" });
		const font = g.state("test", { name: "font" });
		const measurements = textMeasurementProvider({
			graph: g,
			text,
			font,
			adapter: adapterNode(g),
		});
		const bundle = reactiveLayout({
			graph: g,
			measurements,
			lineHeight: -1,
			maxWidth: Number.NaN,
		});
		const height = collect(bundle.height);

		expect(data<number>(height.messages).at(-1)).toBe(0);

		bundle.setLineHeight(Number.NaN);
		expect(data<number>(height.messages).at(-1)).toBe(0);

		height.unsubscribe();
	});

	it("sanitizes external numeric Node inputs at layout consumption", () => {
		const g = graph({ name: "reactive-layout-node-controls" });
		const text = g.state("one", { name: "text" });
		const font = g.state("test", { name: "font" });
		const lineHeight = g.state(Number.NaN, { name: "line-height" });
		const maxWidth = g.state(-10, { name: "max-width" });
		const measurements = textMeasurementProvider({
			graph: g,
			text,
			font,
			adapter: adapterNode(g),
		});
		const bundle = reactiveLayout({
			graph: g,
			measurements,
			lineHeight,
			maxWidth,
		});
		const height = collect(bundle.height);
		const positions = collect(bundle.charPositions);

		const latestHeight = data<number>(height.messages).at(-1);
		expect(Number.isFinite(latestHeight)).toBe(true);
		expect(latestHeight).toBeGreaterThanOrEqual(0);
		expect(data<readonly { readonly height: number }[]>(positions.messages).at(-1)).toEqual(
			expect.arrayContaining([]),
		);

		lineHeight.set(-5);
		maxWidth.set(Number.NaN);

		const nextHeight = data<number>(height.messages).at(-1);
		expect(Number.isFinite(nextHeight)).toBe(true);
		expect(nextHeight).toBeGreaterThanOrEqual(0);

		height.unsubscribe();
		positions.unsubscribe();
	});

	it("clears text measurement cache when the adapter identity changes", () => {
		const g = graph({ name: "text-adapter-swap" });
		const text = g.state("aa", { name: "text" });
		const font = g.state("font", { name: "font" });
		const adapterA: MeasurementAdapter = {
			measureSegment(segment) {
				return { width: segment === "-" ? 1 : segment.length * 5 };
			},
		};
		const adapterB: MeasurementAdapter = {
			measureSegment(segment) {
				return { width: segment === "-" ? 2 : segment.length * 9 };
			},
		};
		const adapter = g.state<MeasurementAdapter>(adapterA, { name: "measure-capability" });
		const measurements = textMeasurementProvider({ graph: g, text, font, adapter });
		const facts = collect(measurements);

		expect(
			(data<Measurements>(facts.messages).at(-1)?.[0] as MeasurementResult<TextSegmentsMeasurement>)
				.value.segments[0]?.width,
		).toBe(10);

		adapter.set(adapterB);

		expect(
			(data<Measurements>(facts.messages).at(-1)?.[0] as MeasurementResult<TextSegmentsMeasurement>)
				.value.segments[0]?.width,
		).toBe(18);
		facts.unsubscribe();
	});

	it("keeps segment facts when only hyphen measurement fails", () => {
		const g = graph({ name: "hyphen-fallback" });
		const text = g.state("word", { name: "text" });
		const font = g.state("font", { name: "font" });
		const adapter: MeasurementAdapter = {
			measureSegment(segment) {
				if (segment === "-") throw new Error("hyphen unavailable");
				return { width: segment.length * 10 };
			},
		};
		const measurements = textMeasurementProvider({
			graph: g,
			text,
			font,
			adapter: g.state(adapter, { name: "measure-capability" }),
		});
		const facts = collect(measurements);
		const latest = data<Measurements>(facts.messages).at(-1);

		expect(latest?.[0]).toMatchObject({
			kind: "ok",
			targetId: "text",
			measurementKind: "text-segments",
		});
		expect((latest?.[0] as MeasurementResult<TextSegmentsMeasurement>).value).not.toHaveProperty(
			"hyphenWidth",
		);
		expect((latest?.[0] as MeasurementResult<TextSegmentsMeasurement>).value.segments).toEqual([
			{ text: "word", width: 40, kind: "text", graphemeWidths: [10, 10, 10, 10] },
		]);
		expect(latest?.[1]).toMatchObject({
			kind: "issue",
			code: "measurement.hyphen.failed",
			subjectId: "text",
		});
		expect(facts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		facts.unsubscribe();
	});

	it("provides universal sync measurement providers", () => {
		let calls = 0;
		const injected = new InjectedMeasureAdapter(
			(text) => {
				calls += 1;
				return text.length * 7;
			},
			{ cache: true },
		);
		expect(injected.measureSegment("aa", "font")).toEqual({ width: 14 });
		expect(injected.measureSegment("aa", "font")).toEqual({ width: 14 });
		expect(calls).toBe(1);
		injected.clearCache();
		expect(injected.measureSegment("aa", "font")).toEqual({ width: 14 });
		expect(calls).toBe(2);

		const precomputed = new PrecomputedMeasureAdapter({
			metrics: { aa: 13 },
			fallback: "per-char",
			cellWidth: 5,
		});
		expect(precomputed.measureSegment("aa", "font")).toEqual({ width: 13 });
		expect(precomputed.measureSegment("bbb", "font")).toEqual({ width: 15 });
		expect(() =>
			new PrecomputedMeasureAdapter({ metrics: {} }).measureSegment("missing", "font"),
		).toThrow(/No precomputed metric/);

		expect(
			new CellMeasureAdapter({ cellWidth: 4, wideCellWidth: 9 }).measureSegment("a界"),
		).toEqual({
			width: 13,
		});
		expect(new CellMeasureAdapter({ cellWidth: 4, tabCells: 3 }).measureSegment("\t")).toEqual({
			width: 12,
		});

		const g = graph({ name: "measurement-providers" });
		const text = g.state("aa", { name: "text" });
		const font = g.state("font", { name: "font" });
		const cellFacts = collect(cellTextMeasurements({ graph: g, text, font, cellWidth: 4 }));
		expect(data<Measurements>(cellFacts.messages).at(-1)).toEqual([
			{
				kind: "ok",
				targetId: "text",
				measurementKind: "text-segments",
				source: "cellTextMeasurements",
				value: {
					segments: [{ text: "aa", width: 8, kind: "text", graphemeWidths: [4, 4] }],
					hyphenWidth: 4,
				},
				metadata: undefined,
			},
		]);
		cellFacts.unsubscribe();

		const missing = collect(
			precomputedTextMeasurements({
				graph: g,
				text,
				font,
				metrics: {},
				name: "precomputed-measurements",
			}),
		);
		expect(data<Measurements>(missing.messages).at(-1)?.[0]).toMatchObject({
			kind: "issue",
			code: "measurement.failed",
			subjectId: "text",
			measurementKind: "text-segments",
		});
		expect(missing.messages.some((message) => message[0] === "ERROR")).toBe(false);
		missing.unsubscribe();
	});

	it("provides caller-injected capability and readiness-gated text measurement helpers", () => {
		const g = graph({ name: "d203-provider-helpers" });
		const text = g.state("aa", { name: "text" });
		const font = g.state("font", { name: "font" });
		const capability = g.state<TextMeasureCapability>(
			{
				measureText(segment: string) {
					return { width: segment === "-" ? 1 : segment.length * 6 };
				},
			},
			{ name: "native-text-capability" },
		);
		const capabilityFacts = collect(
			capabilityTextMeasurements({ graph: g, text, font, capability }),
		);

		expect(
			(
				data<Measurements>(capabilityFacts.messages).at(
					-1,
				)?.[0] as MeasurementResult<TextSegmentsMeasurement>
			).value.segments[0]?.width,
		).toBe(12);
		capabilityFacts.unsubscribe();

		const readiness = g.state<MeasurementReadiness>(
			{ ready: false, code: "font.loading", metadata: { fontFace: "test" } },
			{ name: "font-ready" },
		);
		const readyFacts = collect(
			readinessTextMeasurements({
				graph: g,
				text,
				font,
				adapter: adapterNode(g, "ready-measure-capability"),
				readiness,
				name: "ready-text-measurements",
			}),
		);

		expect(data<Measurements>(readyFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "issue",
			code: "font.loading",
			measurementKind: "text-segments",
			metadata: { fontFace: "test" },
		});

		readiness.set({ ready: true });

		expect(data<Measurements>(readyFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "ok",
			targetId: "text",
			measurementKind: "text-segments",
		});
		readyFacts.unsubscribe();

		let width = 6;
		const cachedAdapter: MeasurementAdapter = {
			measureSegment(segment) {
				return { width: segment === "-" ? 1 : segment.length * width };
			},
		};
		const readinessCache = g.state<MeasurementReadiness>(
			{ ready: true },
			{ name: "cache-font-ready" },
		);
		const cachedFacts = collect(
			readinessTextMeasurements({
				graph: g,
				text,
				font,
				adapter: g.state(cachedAdapter, { name: "cached-ready-measure-capability" }),
				readiness: readinessCache,
				name: "cached-ready-text-measurements",
			}),
		);

		expect(
			(
				data<Measurements>(cachedFacts.messages).at(
					-1,
				)?.[0] as MeasurementResult<TextSegmentsMeasurement>
			).value.segments[0]?.width,
		).toBe(12);

		width = 9;
		readinessCache.set({ ready: false, code: "font.reloading" });
		readinessCache.set({ ready: true });

		expect(
			(
				data<Measurements>(cachedFacts.messages).at(
					-1,
				)?.[0] as MeasurementResult<TextSegmentsMeasurement>
			).value.segments[0]?.width,
		).toBe(18);
		cachedFacts.unsubscribe();
	});

	it("emits standalone readiness, image, and SVG measurement facts as DATA", () => {
		const readinessGraph = graph({ name: "standalone-readiness-provider" });
		const readiness = readinessGraph.state<MeasurementReadiness>(
			{ ready: false, code: "font.loading", metadata: { family: "Inter" } },
			{ name: "font-ready" },
		);
		const readinessFacts = collect(
			readinessMeasurements({
				graph: readinessGraph,
				readiness,
				targetId: "font:Inter",
				source: "font-loader",
			}),
		);

		expect(data<Measurements>(readinessFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "issue",
			code: "font.loading",
			subjectId: "font:Inter",
			measurementKind: READINESS_MEASUREMENT_KIND,
			source: "font-loader",
			metadata: { family: "Inter" },
		});

		readiness.set({ ready: true, source: "font-face-set", metadata: { family: "Inter" } });

		expect(data<Measurements>(readinessFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "ok",
			targetId: "font:Inter",
			measurementKind: READINESS_MEASUREMENT_KIND,
			source: "font-face-set",
			value: { ready: true, source: "font-face-set", metadata: { family: "Inter" } },
		});
		expect(readinessFacts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		readinessFacts.unsubscribe();

		const imageGraph = graph({ name: "image-size-provider" });
		const imageTargets = [
			{ id: "hero", src: "hero", metadata: { role: "cover" } },
			{ src: "inline" },
			{ id: "bad-size", src: "bad-size" },
		] as Array<ImageSizeMeasurementTarget | undefined>;
		imageTargets.length = 4;
		const imageMeasurer = {
			measureImage(src: string) {
				if (src === "hero") return { width: 300, height: 150 };
				if (src === "inline") return { width: 120, height: 80 };
				if (src === "bad-size") return { width: Number.NaN, height: -5 };
				throw new Error(`missing image ${src}`);
			},
		};
		const imageFacts = collect(
			imageSizeMeasurements({
				graph: imageGraph,
				images: imageGraph.state(imageTargets as readonly ImageSizeMeasurementTarget[], {
					name: "images",
				}),
				measurer: imageGraph.state(imageMeasurer, { name: "image-size-capability" }),
			}),
		);
		const latestImages = data<Measurements>(imageFacts.messages).at(-1);

		expect(latestImages?.[0]).toMatchObject({
			kind: "ok",
			targetId: "hero",
			measurementKind: IMAGE_SIZE_MEASUREMENT_KIND,
			value: { width: 300, height: 150 },
			metadata: { role: "cover" },
		});
		expect(latestImages?.[1]).toMatchObject({
			kind: "ok",
			targetId: "inline",
			measurementKind: IMAGE_SIZE_MEASUREMENT_KIND,
			value: { width: 120, height: 80 },
		});
		expect(latestImages?.[2]).toMatchObject({
			kind: "issue",
			code: "measurement.image-size.failed",
			subjectId: "bad-size",
			measurementKind: IMAGE_SIZE_MEASUREMENT_KIND,
		});
		expect(latestImages?.[3]).toMatchObject({
			kind: "issue",
			code: "measurement.image-size.failed",
			subjectId: "image:3",
			measurementKind: IMAGE_SIZE_MEASUREMENT_KIND,
		});
		expect(imageFacts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		imageFacts.unsubscribe();

		const svgGraph = graph({ name: "svg-bounds-provider" });
		const svgTargets = [
			{ id: "mark", svg: '<svg viewBox="0 0 40 20"></svg>' },
			{ id: "bad-size", svg: "<svg data-bad-size></svg>" },
			{ id: "broken", svg: "<g></g>" },
		] satisfies SvgBoundsMeasurementTarget[];
		const svgAdapter = new SvgBoundsAdapter();
		const svgMeasurer = {
			measureSvg(svgText: string) {
				if (svgText.includes("data-bad-size")) {
					return { width: Number.POSITIVE_INFINITY, height: 10 };
				}
				return svgAdapter.measureSvg(svgText);
			},
		};
		const svgFacts = collect(
			svgBoundsMeasurements({
				graph: svgGraph,
				svgs: svgGraph.state(svgTargets, { name: "svgs" }),
				measurer: svgGraph.state(svgMeasurer, { name: "svg-bounds-capability" }),
			}),
		);
		const latestSvgs = data<Measurements>(svgFacts.messages).at(-1);

		expect(latestSvgs?.[0]).toMatchObject({
			kind: "ok",
			targetId: "mark",
			measurementKind: SVG_BOUNDS_MEASUREMENT_KIND,
			value: { width: 40, height: 20 },
		});
		expect(latestSvgs?.[1]).toMatchObject({
			kind: "issue",
			code: "measurement.svg-bounds.failed",
			subjectId: "bad-size",
			measurementKind: SVG_BOUNDS_MEASUREMENT_KIND,
		});
		expect(latestSvgs?.[2]).toMatchObject({
			kind: "issue",
			code: "measurement.svg-bounds.failed",
			subjectId: "broken",
			measurementKind: SVG_BOUNDS_MEASUREMENT_KIND,
		});
		expect(svgFacts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		svgFacts.unsubscribe();
	});

	it("provides focused platform subpath text measurement helpers without native imports", () => {
		const nodeCanvasGraph = graph({ name: "node-canvas-provider" });
		const text = nodeCanvasGraph.state("abcd", { name: "text" });
		const font = nodeCanvasGraph.state("12px test", { name: "font" });
		const contextValue: reactiveLayoutNodeCanvas.NodeCanvasTextContextLike = {
			font: "previous font",
			measureText(segment: string) {
				return { width: segment.length * (this.font.includes("12px") ? 4 : 7) };
			},
		};
		const context = nodeCanvasGraph.state<reactiveLayoutNodeCanvas.NodeCanvasTextContextLike>(
			contextValue,
			{ name: "node-canvas-context" },
		);
		const nodeCanvasFacts = collect(
			reactiveLayoutNodeCanvas.nodeCanvasTextMeasurements({
				graph: nodeCanvasGraph,
				text,
				font,
				context,
			}),
		);

		expect(
			(
				data<Measurements>(nodeCanvasFacts.messages).at(
					-1,
				)?.[0] as MeasurementResult<TextSegmentsMeasurement>
			).value.segments[0]?.width,
		).toBe(16);
		expect(contextValue.font).toBe("previous font");
		nodeCanvasFacts.unsubscribe();

		const concreteGraph = graph({ name: "node-canvas-package-provider" });
		const concreteText = concreteGraph.state("abc", { name: "text" });
		const concreteFont = concreteGraph.state("10px package", { name: "font" });
		let createdCanvas: readonly [number, number] | null = null;
		const concreteFacts = collect(
			reactiveLayoutNodeCanvas.nodeCanvasPackageTextMeasurements({
				graph: concreteGraph,
				text: concreteText,
				font: concreteFont,
				width: 2,
				height: 3,
				canvas: {
					createCanvas(width, height) {
						createdCanvas = [width, height];
						return {
							getContext(type) {
								expect(type).toBe("2d");
								return {
									font: "old",
									measureText(segment: string) {
										return {
											width: segment.length * (this.font.includes("package") ? 5 : 1),
										};
									},
								};
							},
						};
					},
				},
			}),
		);
		expect(createdCanvas).toEqual([2, 3]);
		expect(
			(
				data<Measurements>(concreteFacts.messages).at(
					-1,
				)?.[0] as MeasurementResult<TextSegmentsMeasurement>
			).value.segments[0]?.width,
		).toBe(15);
		concreteFacts.unsubscribe();

		const failingGraph = graph({ name: "node-canvas-package-failure" });
		const failingFacts = collect(
			reactiveLayoutNodeCanvas.nodeCanvasPackageTextMeasurements({
				graph: failingGraph,
				text: failingGraph.state("abc", { name: "text" }),
				font: failingGraph.state("10px package", { name: "font" }),
				canvas: {
					createCanvas() {
						throw new Error("canvas unavailable");
					},
				},
			}),
		);
		expect(data<Measurements>(failingFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "issue",
			code: "measurement.failed",
			subjectId: "text",
			measurementKind: "text-segments",
		});
		expect(failingFacts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		failingFacts.unsubscribe();

		const capabilityGraph = graph({ name: "focused-platform-provider" });
		const platformText = capabilityGraph.state("xy", { name: "text" });
		const platformFont = capabilityGraph.state("font", { name: "font" });
		const capability = capabilityGraph.state<TextMeasureCapability>(
			{
				measureText(segment: string) {
					return { width: segment.length * 8 };
				},
			},
			{ name: "platform-capability" },
		);

		for (const [name, helper] of [
			["skia", reactiveLayoutSkia.skiaTextMeasurements],
			["react-native", reactiveLayoutReactNative.reactNativeTextMeasurements],
		] as const) {
			const facts = collect(
				helper({
					graph: capabilityGraph,
					text: platformText,
					font: platformFont,
					capability,
					name,
				}),
			);
			expect(
				(
					data<Measurements>(facts.messages).at(
						-1,
					)?.[0] as MeasurementResult<TextSegmentsMeasurement>
				).value.segments[0]?.width,
			).toBe(16);
			facts.unsubscribe();
		}

		const skiaGraph = graph({ name: "skia-ready-provider" });
		const skiaText = skiaGraph.state("ready", { name: "text" });
		const skiaFont = skiaGraph.state("Inter", { name: "font" });
		const readiness = skiaGraph.state<MeasurementReadiness>(
			{ ready: false, code: "font.loading" },
			{ name: "skia-font-ready" },
		);
		const paragraphCapability = reactiveLayoutSkia.skiaParagraphTextMeasureCapability({
			Skia: {
				ParagraphBuilder: {
					Make() {
						let textValue = "";
						return {
							pushStyle() {
								return this;
							},
							addText(next: string) {
								textValue += next;
								return this;
							},
							pop() {
								return this;
							},
							build() {
								return {
									layout(width: number) {
										expect(width).toBe(Number.MAX_SAFE_INTEGER);
									},
									getLongestLine() {
										return textValue.length * 6;
									},
								};
							},
						};
					},
				},
			},
			textStyleForFont(fontValue) {
				return { fontFamilies: [fontValue], fontSize: 12 };
			},
		});
		const skiaFacts = collect(
			reactiveLayoutSkia.skiaReadyTextMeasurements({
				graph: skiaGraph,
				text: skiaText,
				font: skiaFont,
				capability: skiaGraph.state(paragraphCapability, { name: "skia-capability" }),
				readiness,
			}),
		);
		expect(data<Measurements>(skiaFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "issue",
			code: "font.loading",
			subjectId: "text",
		});
		readiness.set({ ready: true, source: "useFonts" });
		expect(
			(
				data<Measurements>(skiaFacts.messages).at(
					-1,
				)?.[0] as MeasurementResult<TextSegmentsMeasurement>
			).value.segments[0]?.width,
		).toBe(30);
		skiaFacts.unsubscribe();
	});

	it("projects React Native async layout probes as measurement facts", () => {
		const g = graph({ name: "react-native-layout-probes" });
		const probes = g.state<readonly reactiveLayoutReactNative.ReactNativeLayoutProbe[]>(
			[
				{ id: "card", width: 120, height: 40, source: "onLayout" },
				{ id: "title", ready: false, code: "layout.pending" },
				{ id: "bad", width: Number.NaN, height: 20 },
			],
			{ name: "layout-probes" },
		);
		const facts = collect(
			reactiveLayoutReactNative.reactNativeLayoutMeasurements({ graph: g, probes }),
		);

		const latest = data<Measurements>(facts.messages).at(-1);
		expect(latest?.[0]).toMatchObject({
			kind: "ok",
			targetId: "card",
			measurementKind: reactiveLayoutReactNative.REACT_NATIVE_LAYOUT_MEASUREMENT_KIND,
			value: { width: 120, height: 40 },
			source: "onLayout",
		});
		expect(latest?.[1]).toMatchObject({
			kind: "issue",
			code: "layout.pending",
			subjectId: "title",
		});
		expect(latest?.[2]).toMatchObject({
			kind: "issue",
			code: "measurement.react-native-layout.pending",
			subjectId: "bad",
		});
		probes.set([{ id: "title", width: 80, height: 18 }]);
		expect(data<Measurements>(facts.messages).at(-1)?.[0]).toMatchObject({
			kind: "ok",
			targetId: "title",
			value: { width: 80, height: 18 },
		});
		facts.unsubscribe();
	});
});

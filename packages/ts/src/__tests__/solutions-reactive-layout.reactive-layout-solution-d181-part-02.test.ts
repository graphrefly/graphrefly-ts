import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { Message } from "../protocol/messages.js";
import {
	analyzeAndMeasure,
	type BlockAdapters,
	type BlocksMeasurement,
	blockAdaptersProvider,
	blockMeasurementProvider,
	type ContentBlock,
	cellTextMeasurements,
	circleIntervalForBand,
	computeBlockFlow,
	computeFlowLines,
	computeTotalHeight,
	type FlowColumns,
	type FlowContainer,
	IMAGE_SIZE_MEASUREMENT_KIND,
	ImageSizeAdapter,
	type ImageSizeLookup,
	imageSizeMeasurements,
	type MeasurementAdapter,
	type MeasurementReadiness,
	type MeasurementResult,
	type Measurements,
	measureBlock,
	measureBlocks,
	mergeMeasurements,
	type Obstacle,
	type PreparedSegment,
	READINESS_MEASUREMENT_KIND,
	reactiveBlockLayout,
	reactiveFlowLayout,
	reactiveLayout,
	readinessMeasurements,
	rectIntervalForBand,
	SVG_BOUNDS_MEASUREMENT_KIND,
	SvgBoundsAdapter,
	svgBoundsMeasurements,
	textMeasurementProvider,
} from "../solutions/index.js";
import * as reactiveLayoutBrowser from "../solutions/reactive-layout/browser/index.js";
import * as reactiveLayoutCore from "../solutions/reactive-layout/index.js";

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

function blockAdaptersNode(g: ReturnType<typeof graph>, name = "block-adapters") {
	return g.state<BlockAdapters>(fixedAdapters, { name });
}

describe("reactive-layout solution (D181) — part 2", () => {
	it("merges text, readiness, image, and SVG provider facts into one measurements node", () => {
		const g = graph({ name: "merged-measurement-providers" });
		const text = g.state("hello", { name: "text" });
		const font = g.state("font", { name: "font" });
		const readiness = g.state<MeasurementReadiness>(
			{ ready: true, source: "font-face-set", metadata: { family: "Inter" } },
			{ name: "font-ready" },
		);
		const textFacts = cellTextMeasurements({
			graph: g,
			text,
			font,
			cellWidth: 4,
			targetId: "copy",
			name: "copy-text",
		});
		const readinessFacts = readinessMeasurements({
			graph: g,
			readiness,
			targetId: "font:Inter",
			name: "font-readiness",
		});
		const imageFacts = imageSizeMeasurements({
			graph: g,
			images: g.state([{ id: "hero", src: "hero" }], { name: "images" }),
			measurer: g.state(new ImageSizeAdapter({ hero: { width: 300, height: 150 } }), {
				name: "image-capability",
			}),
		});
		const svgFacts = svgBoundsMeasurements({
			graph: g,
			svgs: g.state([{ id: "mark", svg: '<svg width="80" height="20"></svg>' }], {
				name: "svgs",
			}),
			measurer: g.state(new SvgBoundsAdapter(), { name: "svg-capability" }),
		});
		const sources = [readinessFacts, textFacts, imageFacts, svgFacts];
		const measurements = mergeMeasurements({
			graph: g,
			sources,
			name: "measurements",
		});
		sources.length = 0;
		const layout = reactiveLayout({
			graph: g,
			measurements,
			targetId: "copy",
			maxWidth: 100,
			lineHeight: 10,
		});
		const mergedFacts = collect(measurements);
		const height = collect(layout.height);

		expect(
			data<Measurements>(mergedFacts.messages)
				.at(-1)
				?.map((fact) => [
					fact.kind,
					"targetId" in fact ? fact.targetId : fact.subjectId,
					fact.measurementKind,
				]),
		).toEqual([
			["ok", "font:Inter", READINESS_MEASUREMENT_KIND],
			["ok", "copy", "text-segments"],
			["ok", "hero", IMAGE_SIZE_MEASUREMENT_KIND],
			["ok", "mark", SVG_BOUNDS_MEASUREMENT_KIND],
		]);
		expect(data<number>(height.messages).at(-1)).toBe(10);
		readiness.set({ ready: false, code: "font.reloading" });
		expect(data<Measurements>(mergedFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "issue",
			code: "font.reloading",
			subjectId: "font:Inter",
		});
		mergedFacts.unsubscribe();
		height.unsubscribe();
	});

	it("measures SVG and image blocks without DOM or implicit loading", () => {
		const svg = new SvgBoundsAdapter();
		const readonlySizes: ImageSizeLookup = {
			get(key: string) {
				return key === "hero" ? { width: 300, height: 150 } : undefined;
			},
		};
		const images = new ImageSizeAdapter(readonlySizes);

		expect(svg.measureSvg('<svg viewBox="0 0 40 20"></svg>')).toEqual({ width: 40, height: 20 });
		expect(svg.measureSvg('<svg stroke-width="2" width="100" height="50"></svg>')).toEqual({
			width: 100,
			height: 50,
		});
		expect(() => svg.measureSvg('<svg width="100"><rect height="5"/></svg>')).toThrow(
			/Cannot measure SVG/,
		);
		expect(images.measureImage("hero")).toEqual({ width: 300, height: 150 });
		expect(() => images.measureImage("missing")).toThrow(/No image size registered/);
	});

	it("measures and stacks heterogeneous blocks with pure helpers", () => {
		const cache = new Map<string, Map<string, number>>();
		const text = measureBlock(
			{ kind: "text", id: "copy", text: "hello world", lineHeight: 10 },
			{ adapter: fixedAdapter, font: "test", maxWidth: 60, cache },
		);
		const blocks = measureBlocks(
			[
				{ kind: "text", id: "title", text: "abc", lineHeight: 10 },
				{ kind: "image", id: "hero", src: "hero" },
				{ kind: "svg", id: "mark", svg: '<svg width="80" height="20"></svg>' },
			],
			{
				adapter: fixedAdapter,
				adapters: {
					image: new ImageSizeAdapter({ hero: { width: 200, height: 100 } }),
					svg: new SvgBoundsAdapter(),
				},
				font: "test",
				maxWidth: 100,
			},
		);
		const flow = computeBlockFlow(blocks, 5);

		expect(text.lineBreaks?.lines.map((line) => line.text)).toEqual(["hello ", "world"]);
		expect(text.height).toBe(20);
		expect(blocks.map((block) => [block.id, block.width, block.height])).toEqual([
			["title", 30, 10],
			["hero", 100, 50],
			["mark", 80, 20],
		]);
		expect(flow.map((block) => [block.id, block.y])).toEqual([
			["title", 0],
			["hero", 15],
			["mark", 70],
		]);
		expect(computeTotalHeight(flow)).toBe(90);
	});

	it("builds a graph-visible reactiveBlockLayout bundle", () => {
		const g = graph({ name: "reactive-block-layout" });
		const blocks = g.state<readonly ContentBlock[]>(
			[
				{ kind: "text", id: "one", text: "a", lineHeight: 10 },
				{ kind: "text", id: "two", text: "b", lineHeight: 10 },
			],
			{ name: "blocks" },
		);
		const maxWidth = g.state(100, { name: "max-width" });
		const measurements = blockMeasurementProvider({
			graph: g,
			blocks,
			maxWidth,
			adapters: blockAdaptersNode(g),
			font: g.state("test", { name: "font" }),
		});
		const bundle = reactiveBlockLayout({
			graph: g,
			measurements,
			gap: 5,
		});
		const totalHeight = collect(bundle.totalHeight);

		expect(bundle.graph.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "blocks", to: "blocks-measurements" },
				{ from: "max-width", to: "blocks-measurements" },
				{ from: "block-adapters", to: "blocks-measurements" },
				{ from: "font", to: "blocks-measurements" },
				{ from: "blocks-measurements", to: "reactive-block-layout:measured-blocks" },
				{
					from: "reactive-block-layout:measured-blocks",
					to: "reactive-block-layout:block-flow",
				},
				{ from: "reactive-block-layout:gap", to: "reactive-block-layout:block-flow" },
				{
					from: "reactive-block-layout:block-flow",
					to: "reactive-block-layout:total-height",
				},
			]),
		);
		expect(data<number>(totalHeight.messages).at(-1)).toBe(25);

		bundle.setGap(2);
		expect(data<number>(totalHeight.messages).at(-1)).toBe(22);

		totalHeight.unsubscribe();
	});

	it("clears block measurement cache when the text adapter identity changes", () => {
		const g = graph({ name: "block-adapter-swap" });
		const blocks = g.state<readonly ContentBlock[]>(
			[{ kind: "text", id: "copy", text: "aa", lineHeight: 10 }],
			{ name: "blocks" },
		);
		const maxWidth = g.state(100, { name: "max-width" });
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
		const textAdapter = g.state<MeasurementAdapter>(adapterA, { name: "text-adapter" });
		const measurements = blockMeasurementProvider({
			graph: g,
			blocks,
			maxWidth,
			adapters: blockAdaptersProvider({ graph: g, text: textAdapter }),
			font: g.state("font", { name: "font" }),
		});
		const facts = collect(measurements);

		expect(
			(data<Measurements>(facts.messages).at(-1)?.[0] as MeasurementResult<BlocksMeasurement>).value
				.blocks[0]?.width,
		).toBe(10);

		textAdapter.set(adapterB);

		expect(
			(data<Measurements>(facts.messages).at(-1)?.[0] as MeasurementResult<BlocksMeasurement>).value
				.blocks[0]?.width,
		).toBe(18);
		facts.unsubscribe();
	});

	it("keeps successfully measured blocks when one block fails", () => {
		const g = graph({ name: "partial-block-measurements" });
		const blocks = g.state<readonly ContentBlock[]>(
			[
				{ kind: "text", id: "ok", text: "aa", lineHeight: 10 },
				{ kind: "image", id: "missing", src: "missing" },
			],
			{ name: "blocks" },
		);
		const measurements = blockMeasurementProvider({
			graph: g,
			blocks,
			maxWidth: g.state(100, { name: "max-width" }),
			adapters: blockAdaptersNode(g),
			font: g.state("font", { name: "font" }),
		});
		const facts = collect(measurements);
		const latest = data<Measurements>(facts.messages).at(-1);

		expect((latest?.[0] as MeasurementResult<BlocksMeasurement>).value.blocks).toHaveLength(1);
		expect((latest?.[0] as MeasurementResult<BlocksMeasurement>).value.blocks[0]?.id).toBe("ok");
		expect(latest?.[1]).toMatchObject({
			kind: "issue",
			code: "measurement.block.failed",
			subjectId: "missing",
		});
		expect(facts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		facts.unsubscribe();
	});

	it("keeps block facts visible for hyphen and sparse-block issues", () => {
		const hyphenGraph = graph({ name: "block-hyphen-issue" });
		const hyphenBlocks = hyphenGraph.state<readonly ContentBlock[]>(
			[{ kind: "text", id: "copy", text: "a\u00ADb", lineHeight: 10 }],
			{ name: "blocks" },
		);
		let hyphenMeasurements = 0;
		const hyphenAdapter: MeasurementAdapter = {
			measureSegment(segment) {
				if (segment === "-") {
					hyphenMeasurements += 1;
					throw new Error("hyphen unavailable");
				}
				return { width: segment.length * 10 };
			},
		};
		const hyphenFacts = collect(
			blockMeasurementProvider({
				graph: hyphenGraph,
				blocks: hyphenBlocks,
				maxWidth: hyphenGraph.state(100, { name: "max-width" }),
				adapters: hyphenGraph.state<BlockAdapters>(
					{ text: hyphenAdapter },
					{ name: "block-adapters" },
				),
				font: hyphenGraph.state("font", { name: "font" }),
			}),
		);
		const latestHyphen = data<Measurements>(hyphenFacts.messages).at(-1);

		expect((latestHyphen?.[0] as MeasurementResult<BlocksMeasurement>).value.blocks).toHaveLength(
			1,
		);
		expect(latestHyphen?.[1]).toMatchObject({
			kind: "issue",
			code: "measurement.hyphen.failed",
			subjectId: "copy",
			measurementKind: "blocks",
		});
		expect(hyphenMeasurements).toBe(1);
		hyphenFacts.unsubscribe();

		const sparseGraph = graph({ name: "sparse-block-measurements" });
		const sparseBlocks = [{ kind: "text", id: "ok", text: "aa", lineHeight: 10 }] as Array<
			ContentBlock | undefined
		>;
		sparseBlocks.length = 2;
		const sparseFacts = collect(
			blockMeasurementProvider({
				graph: sparseGraph,
				blocks: sparseGraph.state<readonly ContentBlock[]>(
					sparseBlocks as readonly ContentBlock[],
					{ name: "blocks" },
				),
				maxWidth: sparseGraph.state(100, { name: "max-width" }),
				adapters: blockAdaptersNode(sparseGraph),
				font: sparseGraph.state("font", { name: "font" }),
			}),
		);
		const latestSparse = data<Measurements>(sparseFacts.messages).at(-1);

		expect((latestSparse?.[0] as MeasurementResult<BlocksMeasurement>).value.blocks).toHaveLength(
			1,
		);
		expect(latestSparse?.[1]).toMatchObject({
			kind: "issue",
			code: "measurement.block.failed",
			subjectId: "blocks:1",
		});
		expect(sparseFacts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		sparseFacts.unsubscribe();
	});

	it("sanitizes block and flow numeric Node inputs at consumption", () => {
		const blockGraph = graph({ name: "block-node-controls" });
		const blockMeasurements = blockGraph.state<Measurements>(
			[
				{
					kind: "ok",
					targetId: "blocks",
					measurementKind: "blocks",
					value: {
						blocks: [
							{
								block: { kind: "text", id: "copy", text: "aa" },
								kind: "text",
								id: "copy",
								width: 10,
								height: 10,
								marginTop: 0,
								marginBottom: 0,
							},
						],
					},
				},
			],
			{ name: "block-measurements" },
		);
		const gap = blockGraph.state(Number.NaN, { name: "gap" });
		const block = reactiveBlockLayout({ graph: blockGraph, measurements: blockMeasurements, gap });
		const totalHeight = collect(block.totalHeight);

		expect(data<number>(totalHeight.messages).at(-1)).toBe(10);

		const flowGraph = graph({ name: "flow-node-controls" });
		const text = flowGraph.state("aa", { name: "text" });
		const font = flowGraph.state("font", { name: "font" });
		const flowMeasurements = textMeasurementProvider({
			graph: flowGraph,
			text,
			font,
			adapter: adapterNode(flowGraph),
		});
		const flow = reactiveFlowLayout({
			graph: flowGraph,
			measurements: flowMeasurements,
			lineHeight: flowGraph.state(Number.NaN, { name: "line-height" }),
			container: flowGraph.state<FlowContainer>(
				{ width: Number.NaN, height: -1 },
				{ name: "container" },
			),
			columns: flowGraph.state<FlowColumns>({ count: -3, gap: Number.NaN }, { name: "columns" }),
			obstacles: flowGraph.state<readonly Obstacle[]>(
				[{ kind: "rect", x: -5, y: Number.NaN, width: -10, height: -2 }],
				{ name: "obstacles" },
			),
		});
		const flowLines = collect(flow.flowLines);
		const latestFlow = data<{ readonly lines: readonly unknown[] }>(flowLines.messages).at(-1);

		expect(latestFlow?.lines).toEqual([]);
		expect(flowLines.messages.some((message) => message[0] === "ERROR")).toBe(false);

		totalHeight.unsubscribe();
		flowLines.unsubscribe();
	});

	it("keeps missing measurement as DATA issues and layout no-ops by default", () => {
		const throwingAdapter: MeasurementAdapter = {
			measureSegment() {
				throw new Error("measure exploded");
			},
		};
		const g = graph({ name: "measurement-issues" });
		const text = g.state("boom", { name: "text" });
		const font = g.state("test", { name: "font" });
		const measurements = textMeasurementProvider({
			graph: g,
			text,
			font,
			adapter: g.state<MeasurementAdapter>(throwingAdapter, { name: "measure-capability" }),
		});
		const layout = reactiveLayout({
			graph: g,
			measurements,
		});
		const measurementFacts = collect(measurements);
		const segments = collect(layout.segments);

		expect(data<Measurements>(measurementFacts.messages).at(-1)?.[0]).toMatchObject({
			kind: "issue",
			code: "measurement.failed",
			subjectId: "text",
			measurementKind: "text-segments",
		});
		expect(data<readonly PreparedSegment[]>(segments.messages).at(-1)).toEqual([]);
		expect(measurementFacts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(segments.messages.some((message) => message[0] === "ERROR")).toBe(false);
		measurementFacts.unsubscribe();
		segments.unsubscribe();

		const blockGraph = graph({ name: "block-measurement-issues" });
		const blocks = blockGraph.state<readonly ContentBlock[]>([{ kind: "text", text: "boom" }], {
			name: "blocks",
		});
		const maxWidth = blockGraph.state(100, { name: "max-width" });
		const blockMeasurements = blockMeasurementProvider({
			graph: blockGraph,
			blocks,
			maxWidth,
			adapters: blockGraph.state<BlockAdapters>(
				{ text: throwingAdapter },
				{ name: "block-adapters" },
			),
		});
		const block = reactiveBlockLayout({
			graph: blockGraph,
			measurements: blockMeasurements,
		});
		const blockFacts = collect(blockMeasurements);
		const measuredBlocks = collect(block.measuredBlocks);

		const latestBlockFacts = data<Measurements>(blockFacts.messages).at(-1);
		expect(latestBlockFacts?.[0]).toMatchObject({
			kind: "ok",
			targetId: "blocks",
			measurementKind: "blocks",
			value: { blocks: [] },
		});
		expect(latestBlockFacts?.[1]).toMatchObject({
			kind: "issue",
			code: "measurement.block.failed",
			subjectId: "blocks:0",
			measurementKind: "blocks",
		});
		expect(data<readonly unknown[]>(measuredBlocks.messages).at(-1)).toEqual([]);
		expect(blockFacts.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(measuredBlocks.messages.some((message) => message[0] === "ERROR")).toBe(false);
		blockFacts.unsubscribe();
		measuredBlocks.unsubscribe();

		const flowGraph = graph({ name: "flow-measurement-issues" });
		const flowText = flowGraph.state("boom", { name: "text" });
		const flowFont = flowGraph.state("test", { name: "font" });
		const flowMeasurements = textMeasurementProvider({
			graph: flowGraph,
			text: flowText,
			font: flowFont,
			adapter: flowGraph.state<MeasurementAdapter>(throwingAdapter, {
				name: "measure-capability",
			}),
		});
		const flow = reactiveFlowLayout({
			graph: flowGraph,
			measurements: flowMeasurements,
		});
		const flowSegments = collect(flow.segments);

		expect(data<readonly PreparedSegment[]>(flowSegments.messages).at(-1)).toEqual([]);
		expect(flowSegments.messages.some((message) => message[0] === "ERROR")).toBe(false);
		flowSegments.unsubscribe();
	});

	it("computes multi-column flow lines around pure obstacle intervals", () => {
		const cache = new Map<string, Map<string, number>>();
		const segments = analyzeAndMeasure("abcd efgh", "test", fixedAdapter, cache);

		expect(
			rectIntervalForBand({ kind: "rect", x: 20, y: 0, width: 20, height: 10 }, 0, 10),
		).toEqual({
			left: 20,
			right: 40,
		});
		expect(circleIntervalForBand({ kind: "circle", cx: 50, cy: 5, r: 5 }, 0, 10)).toEqual({
			left: 45,
			right: 55,
		});

		const flow = computeFlowLines(segments, {
			container: { width: 80, height: 30 },
			lineHeight: 10,
			obstacles: [{ kind: "rect", x: 20, y: 0, width: 20, height: 10 }],
			hyphenWidth: fixedAdapter.measureSegment("-", "test").width,
		});

		expect(flow.lines.slice(0, 2).map((line) => [line.text, line.x, line.slotWidth])).toEqual([
			["ab", 0, 20],
			["cd ", 40, 40],
		]);
		expect(flow.done).toBe(true);
	});

	it("builds a graph-visible reactiveFlowLayout bundle", () => {
		const g = graph({ name: "reactive-flow-layout" });
		const text = g.state("abcd ef", { name: "text" });
		const font = g.state("test", { name: "font" });
		const measurements = textMeasurementProvider({
			graph: g,
			text,
			font,
			adapter: adapterNode(g),
		});
		const bundle = reactiveFlowLayout({
			graph: g,
			measurements,
			lineHeight: 10,
			container: { width: 40, height: 40 },
		});
		const flow = collect(bundle.flowLines);

		expect(bundle.graph.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "text", to: "text-measurements" },
				{ from: "font", to: "text-measurements" },
				{ from: "measure-capability", to: "text-measurements" },
				{ from: "text-measurements", to: "reactive-flow-layout:segments" },
				{ from: "reactive-flow-layout:segments", to: "reactive-flow-layout:flow-lines" },
				{
					from: "reactive-flow-layout:line-height",
					to: "reactive-flow-layout:flow-lines",
				},
				{ from: "reactive-flow-layout:container", to: "reactive-flow-layout:flow-lines" },
				{ from: "reactive-flow-layout:columns", to: "reactive-flow-layout:flow-lines" },
				{ from: "reactive-flow-layout:obstacles", to: "reactive-flow-layout:flow-lines" },
				{ from: "text-measurements", to: "reactive-flow-layout:flow-lines" },
			]),
		);
		expect(data<{ readonly lines: readonly unknown[] }>(flow.messages).at(-1)?.lines.length).toBe(
			2,
		);

		bundle.setObstacles([{ kind: "rect", x: 0, y: 0, width: 20, height: 10 }]);
		expect(
			data<{ readonly lines: readonly { readonly x: number }[] }>(flow.messages).at(-1)?.lines[0]
				?.x,
		).toBe(20);

		bundle.setObstacles([{ kind: "rect", x: -10, y: 0, width: 20, height: 10 }]);
		expect(
			data<{ readonly lines: readonly { readonly x: number }[] }>(flow.messages).at(-1)?.lines[0]
				?.x,
		).toBe(10);

		flow.unsubscribe();
	});

	it("keeps CanvasMeasureAdapter behind the browser subpath", () => {
		expect(Object.hasOwn(reactiveLayoutCore, "CanvasMeasureAdapter")).toBe(false);
		expect(Object.hasOwn(reactiveLayoutBrowser, "CanvasMeasureAdapter")).toBe(true);

		const sourcePath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"solutions",
			"reactive-layout",
			"index.ts",
		);
		const source = readFileSync(sourcePath, "utf8");

		expect(source).not.toMatch(/\b(?:OffscreenCanvas|document|window)\b/);
	});
});

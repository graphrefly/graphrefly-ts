import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Message } from "../protocol/messages.js";
import {
	analyzeAndMeasure,
	CellMeasureAdapter,
	carveTextLineSlots,
	circleIntervalForBand,
	computeBlockFlow,
	computeCharPositions,
	computeFlowLines,
	computeLineBreaks,
	computeTotalHeight,
	ImageSizeAdapter,
	InjectedMeasureAdapter,
	type LineBreaksResult,
	layoutNextLine,
	type MeasurementAdapter,
	measureBlock,
	measureBlocks,
	PrecomputedMeasureAdapter,
	type PreparedSegment,
	reactiveBlockLayout,
	reactiveFlowLayout,
	reactiveLayout,
	rectIntervalForBand,
	SvgBoundsAdapter,
} from "../solutions/index.js";
import * as reactiveLayoutBrowser from "../solutions/reactive-layout/browser/index.js";
import * as reactiveLayoutCore from "../solutions/reactive-layout/index.js";

const fixedAdapter: MeasurementAdapter = {
	measureSegment(text) {
		return { width: Array.from(text).length * 10 };
	},
};

const data = <T>(messages: readonly Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

describe("reactive-layout solution (D181)", () => {
	it("prepares measured segments and computes greedy line breaks", () => {
		const cache = new Map<string, Map<string, number>>();
		const segments = analyzeAndMeasure("hello world", "test", fixedAdapter, cache);

		expectTypeOf(segments).toMatchTypeOf<PreparedSegment[]>();
		expect(segments.map((segment) => [segment.text, segment.kind, segment.width])).toEqual([
			["hello", "text", 50],
			[" ", "space", 10],
			["world", "text", 50],
		]);

		const breaks = computeLineBreaks(segments, 60, fixedAdapter, "test", cache);

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
		const breaks = computeLineBreaks(segments, 20, fixedAdapter, "test", cache);

		expect(breaks.lines.map((line) => line.text)).toEqual(["ab", "cd", "ef"]);
		expect(breaks.lines.map((line) => line.width)).toEqual([20, 20, 20]);
	});

	it("consumes hard breaks and continues after whole-word grapheme fallback", () => {
		const hardBreakCache = new Map<string, Map<string, number>>();
		const hardBreakSegments = analyzeAndMeasure("a\nb", "test", fixedAdapter, hardBreakCache);
		const hardBreaks = computeLineBreaks(
			hardBreakSegments,
			20,
			fixedAdapter,
			"test",
			hardBreakCache,
		);

		expect(hardBreaks.lines.map((line) => line.text)).toEqual(["a", "b"]);

		const kernedAdapter: MeasurementAdapter = {
			measureSegment(text) {
				return { width: text === "abcde" ? 100 : Array.from(text).length * 10 };
			},
		};
		const kernedCache = new Map<string, Map<string, number>>();
		const kernedSegments = analyzeAndMeasure("abcde f", "test", kernedAdapter, kernedCache);
		const kernedBreaks = computeLineBreaks(kernedSegments, 50, kernedAdapter, "test", kernedCache);

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
		const breaks = computeLineBreaks(segments, 30, fixedAdapter, "test", cache);

		expect(computeCharPositions(breaks, segments, 12)).toEqual([
			{ x: 0, y: 0, width: 10, height: 12, line: 0 },
			{ x: 10, y: 0, width: 10, height: 12, line: 0 },
			{ x: 20, y: 0, width: 10, height: 12, line: 0 },
			{ x: 0, y: 12, width: 10, height: 12, line: 1 },
			{ x: 10, y: 12, width: 10, height: 12, line: 1 },
		]);
	});

	it("builds a graph-visible reactiveLayout bundle without hidden subscribe islands", () => {
		const bundle = reactiveLayout({
			adapter: fixedAdapter,
			text: "one two",
			font: "test",
			lineHeight: 12,
			maxWidth: 40,
		});
		const breaks = collect(bundle.lineBreaks);
		const height = collect(bundle.height);
		const positions = collect(bundle.charPositions);

		expect(bundle.graph.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "text", to: "segments" },
				{ from: "font", to: "segments" },
				{ from: "segments", to: "line-breaks" },
				{ from: "max-width", to: "line-breaks" },
				{ from: "font", to: "line-breaks" },
				{ from: "line-breaks", to: "height" },
				{ from: "line-height", to: "height" },
				{ from: "line-breaks", to: "char-positions" },
				{ from: "segments", to: "char-positions" },
				{ from: "line-height", to: "char-positions" },
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
		const bundle = reactiveLayout({
			adapter: fixedAdapter,
			text: "one",
			font: "test",
			lineHeight: -1,
			maxWidth: Number.NaN,
		});
		const height = collect(bundle.height);

		expect(data<number>(height.messages).at(-1)).toBe(0);

		bundle.setLineHeight(Number.NaN);
		expect(data<number>(height.messages).at(-1)).toBe(0);

		height.unsubscribe();
	});

	it("provides universal sync measurement adapters", () => {
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
	});

	it("measures SVG and image blocks without DOM or implicit loading", () => {
		const svg = new SvgBoundsAdapter();
		const images = new ImageSizeAdapter({ hero: { width: 300, height: 150 } });

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
		const bundle = reactiveBlockLayout({
			adapter: fixedAdapter,
			blocks: [
				{ kind: "text", id: "one", text: "a", lineHeight: 10 },
				{ kind: "text", id: "two", text: "b", lineHeight: 10 },
			],
			font: "test",
			maxWidth: 100,
			gap: 5,
		});
		const totalHeight = collect(bundle.totalHeight);

		expect(bundle.graph.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "blocks", to: "measured-blocks" },
				{ from: "max-width", to: "measured-blocks" },
				{ from: "measured-blocks", to: "block-flow" },
				{ from: "gap", to: "block-flow" },
				{ from: "block-flow", to: "total-height" },
			]),
		);
		expect(data<number>(totalHeight.messages).at(-1)).toBe(25);

		bundle.setGap(2);
		expect(data<number>(totalHeight.messages).at(-1)).toBe(22);

		totalHeight.unsubscribe();
	});

	it("converts adapter failures in graph-visible bundles to ERROR messages", () => {
		const throwingAdapter: MeasurementAdapter = {
			measureSegment() {
				throw new Error("measure exploded");
			},
		};
		const layout = reactiveLayout({
			adapter: throwingAdapter,
			text: "boom",
			font: "test",
		});
		const segments = collect(layout.segments);

		expect(segments.messages.some((message) => message[0] === "ERROR")).toBe(true);
		segments.unsubscribe();

		const block = reactiveBlockLayout({
			blocks: [{ kind: "text", text: "boom" }],
			adapter: throwingAdapter,
		});
		const measuredBlocks = collect(block.measuredBlocks);

		expect(measuredBlocks.messages.some((message) => message[0] === "ERROR")).toBe(true);
		measuredBlocks.unsubscribe();

		const flow = reactiveFlowLayout({
			adapter: throwingAdapter,
			text: "boom",
		});
		const flowSegments = collect(flow.segments);

		expect(flowSegments.messages.some((message) => message[0] === "ERROR")).toBe(true);
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
			adapter: fixedAdapter,
			font: "test",
			cache,
		});

		expect(flow.lines.slice(0, 2).map((line) => [line.text, line.x, line.slotWidth])).toEqual([
			["ab", 0, 20],
			["cd ", 40, 40],
		]);
		expect(flow.done).toBe(true);
	});

	it("builds a graph-visible reactiveFlowLayout bundle", () => {
		const bundle = reactiveFlowLayout({
			adapter: fixedAdapter,
			text: "abcd ef",
			font: "test",
			lineHeight: 10,
			container: { width: 40, height: 40 },
		});
		const flow = collect(bundle.flowLines);

		expect(bundle.graph.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "text", to: "segments" },
				{ from: "font", to: "segments" },
				{ from: "segments", to: "flow-lines" },
				{ from: "line-height", to: "flow-lines" },
				{ from: "container", to: "flow-lines" },
				{ from: "columns", to: "flow-lines" },
				{ from: "obstacles", to: "flow-lines" },
				{ from: "font", to: "flow-lines" },
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

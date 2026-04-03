/**
 * Tests for reactive multi-content block layout engine (roadmap §7.1 — mixed content).
 *
 * Uses mock adapters with deterministic dimensions (8px per char for text,
 * fixed sizes for images/SVGs) so tests are environment-independent.
 */
import { describe, expect, it } from "vitest";
import { INVALIDATE } from "../../../core/messages.js";
import {
	ImageSizeAdapter,
	SvgBoundsAdapter,
} from "../../../patterns/reactive-layout/measurement-adapters.js";
import {
	type BlockAdapters,
	type ContentBlock,
	computeBlockFlow,
	computeTotalHeight,
	type MeasuredBlock,
	measureBlock,
	measureBlocks,
	type PositionedBlock,
	reactiveBlockLayout,
} from "../../../patterns/reactive-layout/reactive-block-layout.js";
import type { MeasurementAdapter } from "../../../patterns/reactive-layout/reactive-layout.js";

// ---------------------------------------------------------------------------
// Mock adapters
// ---------------------------------------------------------------------------

const CHAR_WIDTH = 8;

function mockTextAdapter(): MeasurementAdapter {
	return {
		measureSegment(text: string, _font: string) {
			return { width: text.length * CHAR_WIDTH };
		},
	};
}

function mockAdapters(extras?: {
	svg?: Record<string, { width: number; height: number }>;
	image?: Record<string, { width: number; height: number }>;
}): BlockAdapters {
	return {
		text: mockTextAdapter(),
		svg: extras?.svg
			? { measureSvg: (content: string) => extras.svg![content] ?? { width: 100, height: 100 } }
			: undefined,
		image: extras?.image ? new ImageSizeAdapter(extras.image) : undefined,
	};
}

// ---------------------------------------------------------------------------
// SvgBoundsAdapter
// ---------------------------------------------------------------------------

describe("SvgBoundsAdapter", () => {
	const adapter = new SvgBoundsAdapter();

	it("extracts dimensions from viewBox", () => {
		const svg = '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"></svg>';
		expect(adapter.measureSvg(svg)).toEqual({ width: 200, height: 100 });
	});

	it("extracts dimensions from viewBox with commas", () => {
		const svg = '<svg viewBox="0,0,300,150"></svg>';
		expect(adapter.measureSvg(svg)).toEqual({ width: 300, height: 150 });
	});

	it("falls back to width/height attributes", () => {
		const svg = '<svg width="120" height="60"></svg>';
		expect(adapter.measureSvg(svg)).toEqual({ width: 120, height: 60 });
	});

	it("prefers viewBox over width/height", () => {
		const svg = '<svg viewBox="0 0 200 100" width="400" height="200"></svg>';
		expect(adapter.measureSvg(svg)).toEqual({ width: 200, height: 100 });
	});

	it("throws for SVG without dimensions", () => {
		expect(() => adapter.measureSvg("<svg><circle r='10'/></svg>")).toThrow(
			/cannot determine dimensions/,
		);
	});

	it("throws when viewBox dimensions are not positive", () => {
		const svg = '<svg viewBox="0 0 0 100"></svg>';
		expect(() => adapter.measureSvg(svg)).toThrow(/viewBox width\/height/);
	});

	it("throws when width/height attributes are not positive", () => {
		const svg = '<svg width="0" height="60"></svg>';
		expect(() => adapter.measureSvg(svg)).toThrow(/width\/height attributes/);
	});
});

// ---------------------------------------------------------------------------
// ImageSizeAdapter
// ---------------------------------------------------------------------------

describe("ImageSizeAdapter", () => {
	const adapter = new ImageSizeAdapter({
		"hero.png": { width: 1200, height: 630 },
		"logo.svg": { width: 120, height: 40 },
	});

	it("returns registered dimensions", () => {
		expect(adapter.measureImage("hero.png")).toEqual({ width: 1200, height: 630 });
	});

	it("throws for unregistered src", () => {
		expect(() => adapter.measureImage("unknown.png")).toThrow(/no dimensions registered/);
	});
});

// ---------------------------------------------------------------------------
// measureBlock — text
// ---------------------------------------------------------------------------

describe("measureBlock", () => {
	const adapters = mockAdapters();
	const cache = new Map<string, Map<string, number>>();
	const font = "16px mono";
	const lh = 20;

	it("measures a text block", () => {
		const block: ContentBlock = { type: "text", text: "hello world" };
		const m = measureBlock(block, 800, adapters, cache, font, lh, 0);
		expect(m.type).toBe("text");
		expect(m.index).toBe(0);
		expect(m.height).toBeGreaterThan(0);
		expect(m.textSegments).toBeDefined();
		expect(m.textLineBreaks).toBeDefined();
		expect(m.textCharPositions).toBeDefined();
	});

	it("measures a text block with line wrapping", () => {
		const block: ContentBlock = { type: "text", text: "hello world" };
		// "hello" = 5*8=40, " "=8, "world"=5*8=40 → total ~88px
		// maxWidth 50 should wrap
		const m = measureBlock(block, 50, adapters, cache, font, lh, 0);
		expect(m.textLineBreaks!.lineCount).toBeGreaterThan(1);
		expect(m.height).toBe(m.textLineBreaks!.lineCount * lh);
	});

	it("measures an image block with explicit dimensions", () => {
		const block: ContentBlock = {
			type: "image",
			src: "pic.png",
			naturalWidth: 400,
			naturalHeight: 300,
		};
		const m = measureBlock(block, 800, adapters, cache, font, lh, 1);
		expect(m).toEqual({ index: 1, type: "image", width: 400, height: 300 });
	});

	it("scales image proportionally when wider than maxWidth", () => {
		const block: ContentBlock = {
			type: "image",
			src: "wide.png",
			naturalWidth: 1600,
			naturalHeight: 900,
		};
		const m = measureBlock(block, 800, adapters, cache, font, lh, 0);
		expect(m.width).toBe(800);
		expect(m.height).toBe(450); // 900 * (800/1600)
	});

	it("measures an image block via adapter", () => {
		const a = mockAdapters({ image: { "hero.png": { width: 1200, height: 630 } } });
		const block: ContentBlock = { type: "image", src: "hero.png" };
		const m = measureBlock(block, 800, a, cache, font, lh, 0);
		// Scaled: 1200 > 800, so 630 * (800/1200) = 420
		expect(m.width).toBe(800);
		expect(m.height).toBe(420);
	});

	it("throws for image without dimensions or adapter", () => {
		const block: ContentBlock = { type: "image", src: "no-dims.png" };
		expect(() => measureBlock(block, 800, adapters, cache, font, lh, 0)).toThrow(
			/no naturalWidth\/naturalHeight and no ImageMeasurer/,
		);
	});

	it("measures an SVG block with viewBox", () => {
		const block: ContentBlock = {
			type: "svg",
			content: '<svg viewBox="0 0 200 100"></svg>',
			viewBox: { width: 200, height: 100 },
		};
		const m = measureBlock(block, 800, adapters, cache, font, lh, 2);
		expect(m).toEqual({ index: 2, type: "svg", width: 200, height: 100 });
	});

	it("scales SVG proportionally when wider than maxWidth", () => {
		const block: ContentBlock = {
			type: "svg",
			content: "<svg></svg>",
			viewBox: { width: 1000, height: 500 },
		};
		const m = measureBlock(block, 800, adapters, cache, font, lh, 0);
		expect(m.width).toBe(800);
		expect(m.height).toBe(400); // 500 * (800/1000)
	});

	it("throws for SVG without viewBox or adapter", () => {
		const block: ContentBlock = { type: "svg", content: "<svg><rect/></svg>" };
		expect(() => measureBlock(block, 800, adapters, cache, font, lh, 0)).toThrow(
			/no viewBox and no SvgMeasurer/,
		);
	});
});

// ---------------------------------------------------------------------------
// measureBlocks
// ---------------------------------------------------------------------------

describe("measureBlocks", () => {
	it("measures mixed content blocks", () => {
		const adapters = mockAdapters();
		const blocks: ContentBlock[] = [
			{ type: "text", text: "hello" },
			{ type: "image", src: "pic.png", naturalWidth: 200, naturalHeight: 100 },
			{ type: "text", text: "world" },
		];
		const result = measureBlocks(blocks, 800, adapters, new Map(), "16px mono", 20);
		expect(result).toHaveLength(3);
		expect(result[0]!.type).toBe("text");
		expect(result[1]!.type).toBe("image");
		expect(result[2]!.type).toBe("text");
		expect(result[0]!.index).toBe(0);
		expect(result[1]!.index).toBe(1);
		expect(result[2]!.index).toBe(2);
	});

	it("returns empty for empty blocks", () => {
		expect(measureBlocks([], 800, mockAdapters(), new Map(), "16px mono", 20)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// computeBlockFlow
// ---------------------------------------------------------------------------

describe("computeBlockFlow", () => {
	const blocks: MeasuredBlock[] = [
		{ index: 0, type: "text", width: 200, height: 40 },
		{ index: 1, type: "image", width: 300, height: 150 },
		{ index: 2, type: "text", width: 200, height: 60 },
	];

	it("stacks blocks vertically with zero gap", () => {
		const flow = computeBlockFlow(blocks, 0);
		expect(flow).toHaveLength(3);
		expect(flow[0]).toMatchObject({ x: 0, y: 0, height: 40 });
		expect(flow[1]).toMatchObject({ x: 0, y: 40, height: 150 });
		expect(flow[2]).toMatchObject({ x: 0, y: 190, height: 60 });
	});

	it("stacks blocks vertically with gap", () => {
		const flow = computeBlockFlow(blocks, 10);
		expect(flow[0]).toMatchObject({ x: 0, y: 0 });
		expect(flow[1]).toMatchObject({ x: 0, y: 50 }); // 40 + 10
		expect(flow[2]).toMatchObject({ x: 0, y: 210 }); // 50 + 150 + 10
	});

	it("returns empty for empty input", () => {
		expect(computeBlockFlow([], 0)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// computeTotalHeight
// ---------------------------------------------------------------------------

describe("computeTotalHeight", () => {
	it("returns 0 for empty flow", () => {
		expect(computeTotalHeight([])).toBe(0);
	});

	it("returns last block y + height", () => {
		const flow: PositionedBlock[] = [
			{ index: 0, type: "text", width: 200, height: 40, x: 0, y: 0 },
			{ index: 1, type: "image", width: 300, height: 150, x: 0, y: 50 },
		];
		expect(computeTotalHeight(flow)).toBe(200); // 50 + 150
	});
});

// ---------------------------------------------------------------------------
// reactiveBlockLayout — factory
// ---------------------------------------------------------------------------

describe("reactiveBlockLayout", () => {
	it("creates a graph with expected nodes", () => {
		const bundle = reactiveBlockLayout({ adapters: mockAdapters() });
		const desc = bundle.graph.describe();
		expect(desc.nodes).toHaveProperty("blocks");
		expect(desc.nodes).toHaveProperty("max-width");
		expect(desc.nodes).toHaveProperty("gap");
		expect(desc.nodes).toHaveProperty("measured-blocks");
		expect(desc.nodes).toHaveProperty("block-flow");
		expect(desc.nodes).toHaveProperty("total-height");
	});

	it("has correct edges for describe() visibility", () => {
		const bundle = reactiveBlockLayout({ adapters: mockAdapters() });
		const desc = bundle.graph.describe();
		const edgeStrings = desc.edges.map((e: { from: string; to: string }) => `${e.from}->${e.to}`);
		expect(edgeStrings).toContain("blocks->measured-blocks");
		expect(edgeStrings).toContain("max-width->measured-blocks");
		expect(edgeStrings).toContain("measured-blocks->block-flow");
		expect(edgeStrings).toContain("gap->block-flow");
		expect(edgeStrings).toContain("block-flow->total-height");
	});

	it("computes correct height for text blocks", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [{ type: "text", text: "hello world" }],
			maxWidth: 800,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		expect(bundle.totalHeight.get()).toBeGreaterThan(0);
		unsub();
	});

	it("computes correct height for mixed blocks", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [
				{ type: "text", text: "hello" },
				{ type: "image", src: "pic.png", naturalWidth: 200, naturalHeight: 100 },
			],
			maxWidth: 800,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		const flow = bundle.blockFlow.get() as PositionedBlock[];
		expect(flow).toHaveLength(2);
		expect(flow[0]!.type).toBe("text");
		expect(flow[1]!.type).toBe("image");
		expect(flow[1]!.width).toBe(200);
		expect(flow[1]!.height).toBe(100);
		const total = bundle.totalHeight.get();
		expect(total).toBe(flow[0]!.height + flow[1]!.height);
		unsub();
	});

	it("recomputes on setBlocks", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [{ type: "text", text: "hello" }],
			maxWidth: 800,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		const h1 = bundle.totalHeight.get();
		bundle.setBlocks([
			{ type: "text", text: "hello" },
			{ type: "image", src: "x.png", naturalWidth: 100, naturalHeight: 50 },
		]);
		const h2 = bundle.totalHeight.get();
		expect(h2).toBeGreaterThan(h1);
		unsub();
	});

	it("recomputes on setMaxWidth", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [{ type: "image", src: "wide.png", naturalWidth: 1600, naturalHeight: 900 }],
			maxWidth: 800,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		const m1 = bundle.measuredBlocks.get() as MeasuredBlock[];
		expect(m1[0]!.width).toBe(800);
		expect(m1[0]!.height).toBe(450);

		bundle.setMaxWidth(400);
		const m2 = bundle.measuredBlocks.get() as MeasuredBlock[];
		expect(m2[0]!.width).toBe(400);
		expect(m2[0]!.height).toBe(225);
		unsub();
	});

	it("respects gap setting", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [
				{ type: "image", src: "a.png", naturalWidth: 100, naturalHeight: 50 },
				{ type: "image", src: "b.png", naturalWidth: 100, naturalHeight: 50 },
			],
			maxWidth: 800,
			gap: 10,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		const flow = bundle.blockFlow.get() as PositionedBlock[];
		expect(flow[0]!.y).toBe(0);
		expect(flow[1]!.y).toBe(60); // 50 + 10
		expect(bundle.totalHeight.get()).toBe(110); // 60 + 50
		unsub();
	});

	it("setGap recomputes flow", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [
				{ type: "image", src: "a.png", naturalWidth: 100, naturalHeight: 50 },
				{ type: "image", src: "b.png", naturalWidth: 100, naturalHeight: 50 },
			],
			maxWidth: 800,
			gap: 0,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		expect(bundle.totalHeight.get()).toBe(100);
		bundle.setGap(20);
		expect(bundle.totalHeight.get()).toBe(120);
		unsub();
	});

	it("INVALIDATE clears measurement cache", () => {
		let clearCount = 0;
		const adapter: MeasurementAdapter = {
			measureSegment(text: string, _font: string) {
				return { width: text.length * CHAR_WIDTH };
			},
			clearCache() {
				clearCount++;
			},
		};
		const bundle = reactiveBlockLayout({
			adapters: { text: adapter },
			blocks: [{ type: "text", text: "hello" }],
			maxWidth: 800,
		});
		const unsub = bundle.measuredBlocks.subscribe(() => {});
		// Force initial computation
		bundle.measuredBlocks.get();

		// Send INVALIDATE to the graph — signal broadcasts to all nodes,
		// so clearCache may be called more than once (once per INVALIDATE delivery)
		bundle.graph.signal([[INVALIDATE]]);
		expect(clearCount).toBeGreaterThanOrEqual(1);
		unsub();
	});

	it("graph is snapshotable", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [{ type: "text", text: "hello" }],
			maxWidth: 800,
		});
		const snap = bundle.graph.snapshot();
		expect(snap).toBeDefined();
		expect(snap.nodes).toHaveProperty("blocks");
		expect(snap.nodes).toHaveProperty("total-height");
	});

	it("measured-blocks meta has block-count and layout-time-ns", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [
				{ type: "text", text: "hello" },
				{ type: "image", src: "a.png", naturalWidth: 100, naturalHeight: 50 },
			],
			maxWidth: 800,
		});
		const unsub = bundle.measuredBlocks.subscribe(() => {});
		// Force computation
		bundle.measuredBlocks.get();
		const mbNode = bundle.graph.node("measured-blocks");
		expect(mbNode.meta).toBeDefined();
		expect(mbNode.meta["block-count"]?.get()).toBe(2);
		expect(typeof mbNode.meta["layout-time-ns"]?.get()).toBe("number");
		unsub();
	});

	it("INVALIDATE preserves meta values (spec §2.3 — meta survives INVALIDATE)", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [
				{ type: "text", text: "hello" },
				{ type: "image", src: "a.png", naturalWidth: 100, naturalHeight: 50 },
			],
			maxWidth: 800,
		});
		const unsub = bundle.measuredBlocks.subscribe(() => {});
		bundle.measuredBlocks.get();

		const mbNode = bundle.graph.node("measured-blocks");
		const countBefore = mbNode.meta["block-count"]?.get();
		expect(countBefore).toBe(2);

		bundle.graph.signal([[INVALIDATE]]);

		// Meta should survive INVALIDATE (spec §2.3)
		expect(mbNode.meta["block-count"]?.get()).toBe(countBefore);
		unsub();
	});

	it("handles negative gap (overlapping blocks)", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [
				{ type: "image", src: "a.png", naturalWidth: 100, naturalHeight: 50 },
				{ type: "image", src: "b.png", naturalWidth: 100, naturalHeight: 50 },
			],
			maxWidth: 800,
			gap: -10,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		const flow = bundle.blockFlow.get() as PositionedBlock[];
		expect(flow[0]!.y).toBe(0);
		expect(flow[1]!.y).toBe(40); // 50 + (-10)
		expect(bundle.totalHeight.get()).toBe(90); // 40 + 50
		unsub();
	});

	it("handles zero maxWidth (degenerate)", () => {
		// Zero maxWidth: images scale to 0, text wraps per-grapheme
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [{ type: "image", src: "a.png", naturalWidth: 100, naturalHeight: 50 }],
			maxWidth: 0,
		});
		const unsub = bundle.totalHeight.subscribe(() => {});
		const m = bundle.measuredBlocks.get() as MeasuredBlock[];
		// Image wider than maxWidth=0: scales to w=0, h=0
		expect(m[0]!.width).toBe(0);
		expect(m[0]!.height).toBe(0);
		unsub();
	});

	it("clamps negative maxWidth to 0 on init and setMaxWidth", () => {
		const bundle = reactiveBlockLayout({
			adapters: mockAdapters(),
			blocks: [],
			maxWidth: -100,
		});
		expect(bundle.graph.get("max-width")).toBe(0);
		bundle.setMaxWidth(-5);
		expect(bundle.graph.get("max-width")).toBe(0);
	});
});

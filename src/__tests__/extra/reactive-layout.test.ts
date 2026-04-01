/**
 * Tests for reactive text layout engine (roadmap §7.1 — Pretext parity).
 *
 * Uses a MockMeasureAdapter with deterministic widths (8px per character)
 * so tests are environment-independent (no Canvas/DOM).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
	analyzeAndMeasure,
	computeCharPositions,
	computeLineBreaks,
	type LineBreaksResult,
	type MeasurementAdapter,
	type PreparedSegment,
	reactiveLayout,
	type SegmentMeasureStats,
} from "../../extra/reactive-layout.js";

// ---------------------------------------------------------------------------
// Mock adapter: 8px per character (deterministic, no Canvas)
// ---------------------------------------------------------------------------

const CHAR_WIDTH = 8;

function mockAdapter(): MeasurementAdapter {
	return {
		measureSegment(text: string, _font: string) {
			return { width: text.length * CHAR_WIDTH };
		},
	};
}

// ---------------------------------------------------------------------------
// Text analysis
// ---------------------------------------------------------------------------

describe("analyzeAndMeasure", () => {
	const adapter = mockAdapter();

	it("segments simple text into words and spaces", () => {
		const segs = analyzeAndMeasure("hello world", "16px mono", adapter, new Map());
		// Should have at least: "hello", " ", "world"
		const texts = segs.map((s) => s.text);
		expect(texts).toContain("hello");
		expect(texts).toContain("world");
		// Space segment(s) present
		const spaceSegs = segs.filter((s) => s.kind === "space");
		expect(spaceSegs.length).toBeGreaterThan(0);
	});

	it("returns empty array for empty text", () => {
		expect(analyzeAndMeasure("", "16px mono", adapter, new Map())).toEqual([]);
	});

	it("returns empty array for whitespace-only text", () => {
		expect(analyzeAndMeasure("   ", "16px mono", adapter, new Map())).toEqual([]);
	});

	it("normalizes collapsible whitespace", () => {
		const segs = analyzeAndMeasure("hello   world", "16px mono", adapter, new Map());
		// Multiple spaces collapse to single space
		const spaceSegs = segs.filter((s) => s.kind === "space");
		for (const s of spaceSegs) {
			expect(s.text).toBe(" ");
		}
	});

	it("merges left-sticky punctuation into preceding word", () => {
		const segs = analyzeAndMeasure("hello, world", "16px mono", adapter, new Map());
		// "hello," should be a single segment (comma merged)
		const helloSeg = segs.find((s) => s.text.startsWith("hello"));
		expect(helloSeg).toBeDefined();
		expect(helloSeg!.text).toBe("hello,");
	});

	it("measures segment widths correctly", () => {
		const segs = analyzeAndMeasure("abc", "16px mono", adapter, new Map());
		const textSeg = segs.find((s) => s.kind === "text");
		expect(textSeg).toBeDefined();
		expect(textSeg!.width).toBe(3 * CHAR_WIDTH);
	});

	it("caches measurements per font", () => {
		const cache = new Map<string, Map<string, number>>();
		analyzeAndMeasure("abc", "16px mono", adapter, cache);
		expect(cache.has("16px mono")).toBe(true);
		// Second call uses cache
		analyzeAndMeasure("abc def", "16px mono", adapter, cache);
		expect(cache.get("16px mono")!.has("abc")).toBe(true);
	});

	it("splits CJK text into per-grapheme segments", () => {
		const segs = analyzeAndMeasure("你好世界", "16px mono", adapter, new Map());
		// CJK characters should be split for per-character line breaking
		expect(segs.length).toBeGreaterThanOrEqual(2);
		for (const seg of segs) {
			if (seg.kind === "text") {
				// Each CJK grapheme should be its own segment (or small clusters with kinsoku)
				expect(seg.text.length).toBeLessThanOrEqual(2);
			}
		}
	});

	it("pre-computes grapheme widths for long words (break-word)", () => {
		const segs = analyzeAndMeasure("superlongword", "16px mono", adapter, new Map());
		const wordSeg = segs.find((s) => s.kind === "text" && s.text === "superlongword");
		expect(wordSeg).toBeDefined();
		expect(wordSeg!.graphemeWidths).not.toBeNull();
		expect(wordSeg!.graphemeWidths!.length).toBe(13);
	});

	it("handles soft hyphens", () => {
		const segs = analyzeAndMeasure("auto\u00ADmatic", "16px mono", adapter, new Map());
		const kinds = segs.map((s) => s.kind);
		expect(kinds).toContain("soft-hyphen");
	});

	it("optional stats bag records hits and misses for cache ratio", () => {
		const cache = new Map<string, Map<string, number>>();
		const stats: SegmentMeasureStats = { hits: 0, misses: 0 };
		analyzeAndMeasure("aa", "16px mono", adapter, cache, stats);
		expect(stats.misses).toBeGreaterThan(0);
		const missesAfterFirst = stats.misses;
		const hitsAfterFirst = stats.hits;
		analyzeAndMeasure("aa", "16px mono", adapter, cache, stats);
		expect(stats.hits).toBeGreaterThan(hitsAfterFirst);
		expect(stats.misses).toBe(missesAfterFirst);
	});
});

// ---------------------------------------------------------------------------
// Line breaking
// ---------------------------------------------------------------------------

describe("computeLineBreaks", () => {
	const adapter = mockAdapter();
	const font = "16px mono";

	function breakLines(text: string, maxWidth: number): LineBreaksResult {
		const cache = new Map<string, Map<string, number>>();
		const segs = analyzeAndMeasure(text, font, adapter, cache);
		return computeLineBreaks(segs, maxWidth, adapter, font, cache);
	}

	it("single line when text fits", () => {
		const result = breakLines("hello", 100);
		expect(result.lineCount).toBe(1);
		expect(result.lines[0]!.text).toBe("hello");
		expect(result.lines[0]!.width).toBe(5 * CHAR_WIDTH);
	});

	it("wraps at word boundary", () => {
		// "hello world" = 5*8 + 8 + 5*8 = 88px; maxWidth=60 forces wrap
		const result = breakLines("hello world", 60);
		expect(result.lineCount).toBe(2);
		// Trailing space hangs past line edge (CSS behavior), included in line text
		expect(result.lines[0]!.text).toBe("hello ");
		expect(result.lines[1]!.text).toBe("world");
	});

	it("handles multiple words wrapping across lines", () => {
		// "aa bb cc" → each word = 16px, space = 8px
		// maxWidth = 30: "aa" fits (16), "aa bb" = 40 > 30
		const result = breakLines("aa bb cc", 30);
		expect(result.lineCount).toBe(3);
	});

	it("empty text produces no lines", () => {
		const result = breakLines("", 100);
		expect(result.lineCount).toBe(0);
		expect(result.lines).toEqual([]);
	});

	it("break-word splits long words at grapheme boundaries", () => {
		// "abcdefghij" = 80px; maxWidth=40 → needs 2 lines
		const result = breakLines("abcdefghij", 40);
		expect(result.lineCount).toBe(2);
		// First line should have 5 chars (40px), second line 5 chars
		expect(result.lines[0]!.text.length).toBe(5);
		expect(result.lines[1]!.text.length).toBe(5);
	});

	it("trailing space hangs past line edge", () => {
		// "hello " + "world"; maxWidth exactly fits "hello" (40px)
		// Space should hang, "world" goes to next line
		const result = breakLines("hello world", 40);
		expect(result.lineCount).toBe(2);
		expect(result.lines[0]!.text).toBe("hello ");
		expect(result.lines[1]!.text).toBe("world");
	});

	it("handles hard breaks (newline)", () => {
		// analyzeAndMeasure normalizes whitespace, so hard breaks inside
		// normalized text are preserved only if present after normalization.
		// For this test, use the raw computeLineBreaks with manual segments.
		const segs: PreparedSegment[] = [
			{ text: "line1", width: 40, kind: "text", graphemeWidths: null },
			{ text: "\n", width: 0, kind: "hard-break", graphemeWidths: null },
			{ text: "line2", width: 40, kind: "text", graphemeWidths: null },
		];
		const cache = new Map<string, Map<string, number>>();
		const result = computeLineBreaks(segs, 200, adapter, font, cache);
		expect(result.lineCount).toBe(2);
		expect(result.lines[0]!.text).toBe("line1");
		expect(result.lines[1]!.text).toBe("line2");
	});

	it("soft hyphen creates break opportunity with visible hyphen", () => {
		// "auto" + soft-hyphen + "matic" — if maxWidth forces break at hyphen
		const segs: PreparedSegment[] = [
			{ text: "auto", width: 32, kind: "text", graphemeWidths: null },
			{ text: "\u00AD", width: 0, kind: "soft-hyphen", graphemeWidths: null },
			{ text: "matic", width: 40, kind: "text", graphemeWidths: null },
		];
		const cache = new Map<string, Map<string, number>>();
		// maxWidth = 40: "auto" (32) + soft-hyphen (0) + "matic" (40) = 72 > 40
		const result = computeLineBreaks(segs, 40, adapter, font, cache);
		expect(result.lineCount).toBe(2);
		expect(result.lines[0]!.text).toBe("auto-");
		expect(result.lines[1]!.text).toBe("matic");
	});
});

// ---------------------------------------------------------------------------
// Char positions
// ---------------------------------------------------------------------------

describe("computeCharPositions", () => {
	const lineHeight = 20;

	it("computes x,y for single-line text", () => {
		const segs: PreparedSegment[] = [
			{
				text: "abc",
				width: 24,
				kind: "text",
				graphemeWidths: [8, 8, 8],
			},
		];
		const lb: LineBreaksResult = {
			lineCount: 1,
			lines: [
				{
					text: "abc",
					width: 24,
					startSegment: 0,
					startGrapheme: 0,
					endSegment: 1,
					endGrapheme: 0,
				},
			],
		};
		const positions = computeCharPositions(lb, segs, lineHeight);
		expect(positions.length).toBe(3);
		expect(positions[0]).toEqual({
			x: 0,
			y: 0,
			width: 8,
			height: 20,
			line: 0,
		});
		expect(positions[1]).toEqual({
			x: 8,
			y: 0,
			width: 8,
			height: 20,
			line: 0,
		});
		expect(positions[2]).toEqual({
			x: 16,
			y: 0,
			width: 8,
			height: 20,
			line: 0,
		});
	});

	it("computes y offset for second line", () => {
		const segs: PreparedSegment[] = [
			{
				text: "ab",
				width: 16,
				kind: "text",
				graphemeWidths: [8, 8],
			},
			{ text: " ", width: 8, kind: "space", graphemeWidths: null },
			{
				text: "cd",
				width: 16,
				kind: "text",
				graphemeWidths: [8, 8],
			},
		];
		const lb: LineBreaksResult = {
			lineCount: 2,
			lines: [
				{
					text: "ab",
					width: 16,
					startSegment: 0,
					startGrapheme: 0,
					endSegment: 1,
					endGrapheme: 0,
				},
				{
					text: "cd",
					width: 16,
					startSegment: 2,
					startGrapheme: 0,
					endSegment: 3,
					endGrapheme: 0,
				},
			],
		};
		const positions = computeCharPositions(lb, segs, lineHeight);
		// Line 2 chars should have y = 20
		const line2Pos = positions.filter((p) => p.line === 1);
		expect(line2Pos.length).toBe(2);
		expect(line2Pos[0]!.y).toBe(20);
	});

	it("skips empty TEXT segments without dividing by zero", () => {
		const segs: PreparedSegment[] = [{ text: "", width: 0, kind: "text", graphemeWidths: null }];
		const lb: LineBreaksResult = {
			lineCount: 1,
			lines: [
				{
					text: "",
					width: 0,
					startSegment: 0,
					startGrapheme: 0,
					endSegment: 1,
					endGrapheme: 0,
				},
			],
		};
		expect(computeCharPositions(lb, segs, 20)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Reactive graph factory
// ---------------------------------------------------------------------------

describe("reactiveLayout", () => {
	let layout: ReturnType<typeof reactiveLayout>;

	afterEach(() => {
		layout?.graph.destroy();
	});

	it("creates a graph with all expected nodes", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "hello world",
			maxWidth: 200,
		});
		const desc = layout.graph.describe();
		expect(desc.nodes).toHaveProperty("text");
		expect(desc.nodes).toHaveProperty("font");
		expect(desc.nodes).toHaveProperty("line-height");
		expect(desc.nodes).toHaveProperty("max-width");
		expect(desc.nodes).toHaveProperty("segments");
		expect(desc.nodes).toHaveProperty("line-breaks");
		expect(desc.nodes).toHaveProperty("height");
		expect(desc.nodes).toHaveProperty("char-positions");
	});

	it("computes correct height for single-line text", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "hello",
			font: "16px mono",
			lineHeight: 20,
			maxWidth: 200,
		});
		const unsub = layout.height.subscribe(() => {});
		expect(layout.height.get()).toBe(20); // 1 line * 20px
		unsub();
	});

	it("recomputes on text change", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "hello",
			font: "16px mono",
			lineHeight: 20,
			maxWidth: 48, // 6 chars fit
		});

		const unsub = layout.height.subscribe(() => {});

		// Initial: "hello" (5 chars = 40px) fits in 48px → 1 line
		expect(layout.height.get()).toBe(20);

		// Change text to something that wraps
		layout.setText("hello world"); // 11 chars + space → wraps
		expect(layout.height.get()).toBe(40); // 2 lines
		unsub();
	});

	it("recomputes on maxWidth change", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "hello world",
			font: "16px mono",
			lineHeight: 20,
			maxWidth: 200,
		});

		const unsub = layout.height.subscribe(() => {});
		expect(layout.height.get()).toBe(20); // Fits in 1 line

		layout.setMaxWidth(40); // Force wrap
		expect(layout.height.get()).toBe(40); // 2 lines
		unsub();
	});

	it("segments node has meta for observability", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "hello world",
			maxWidth: 200,
		});
		const desc = layout.graph.describe();
		const segDesc = desc.nodes.segments;
		expect(segDesc).toBeDefined();
		expect(segDesc!.meta).toBeDefined();
		expect(segDesc!.meta).toHaveProperty("cache-hit-rate");
		expect(segDesc!.meta).toHaveProperty("segment-count");
		expect(segDesc!.meta).toHaveProperty("layout-time-ns");
	});

	it("RESOLVED optimization: unchanged text/font skips re-measure", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "hello",
			font: "16px mono",
			lineHeight: 20,
			maxWidth: 200,
		});

		const unsub = layout.segments.subscribe(() => {});
		const segs1 = layout.segments.get();
		// Set same text — should trigger RESOLVED (no change)
		layout.setText("hello");
		const segs2 = layout.segments.get();
		expect(segs1).toEqual(segs2);
		unsub();
	});

	it("char positions are computed correctly", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "ab",
			font: "16px mono",
			lineHeight: 20,
			maxWidth: 200,
		});

		const unsub = layout.charPositions.subscribe(() => {});
		const positions = layout.charPositions.get();
		expect(positions.length).toBe(2);
		expect(positions[0]!.x).toBe(0);
		expect(positions[0]!.y).toBe(0);
		expect(positions[0]!.width).toBe(CHAR_WIDTH);
		expect(positions[1]!.x).toBe(CHAR_WIDTH);
		unsub();
	});

	it("graph is snapshotable", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "test",
			maxWidth: 200,
		});
		const snapshot = layout.graph.snapshot();
		expect(snapshot).toBeDefined();
		expect(snapshot.name).toBe("reactive-layout");
	});

	it("graph is describable with edges", () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "test",
			maxWidth: 200,
		});
		const desc = layout.graph.describe();
		expect(desc.edges.length).toBeGreaterThan(0);
	});

	it("meta companion DATA runs after segments DATA (microtask ordering)", async () => {
		layout = reactiveLayout({
			adapter: mockAdapter(),
			text: "a",
			maxWidth: 200,
		});
		const order: string[] = [];
		const u1 = layout.segments.subscribe(() => {
			order.push("segments");
		});
		const u2 = layout.segments.meta?.["cache-hit-rate"]?.subscribe(() => {
			order.push("meta");
		});
		const start = order.length;
		layout.setText("b");
		const afterSync = order.length;
		// DIRTY/DATA or RESOLVED can invoke the sink more than once; meta must not run yet.
		expect(order.slice(start, afterSync).every((x) => x === "segments")).toBe(true);
		await Promise.resolve();
		const metaChunk = order.slice(afterSync);
		expect(metaChunk.length).toBeGreaterThanOrEqual(1);
		expect(metaChunk.every((x) => x === "meta")).toBe(true);
		u1();
		u2?.();
	});
});

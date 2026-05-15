/**
 * Tests for cursor-based single-line layout + slot carving + flow-layout factory.
 *
 * Mock adapter is 8px per character (deterministic, no Canvas).
 */
import { describe, expect, it } from "vitest";
import {
	circleIntervalForBand,
	computeFlowLines,
	reactiveFlowLayout,
	rectIntervalForBand,
} from "../../../utils/reactive-layout/reactive-flow-layout.js";
import {
	analyzeAndMeasure,
	carveTextLineSlots,
	type LayoutCursor,
	layoutNextLine,
	type MeasurementAdapter,
	type PreparedSegment,
} from "../../../utils/reactive-layout/reactive-layout.js";

const CHAR_WIDTH = 8;

function mockAdapter(): MeasurementAdapter {
	return {
		measureSegment(text: string, _font: string) {
			return { width: text.length * CHAR_WIDTH };
		},
	};
}

function prep(text: string): PreparedSegment[] {
	return analyzeAndMeasure(text, "16px mono", mockAdapter(), new Map());
}

// ---------------------------------------------------------------------------
// carveTextLineSlots
// ---------------------------------------------------------------------------

describe("carveTextLineSlots", () => {
	it("returns base when no blockers", () => {
		expect(carveTextLineSlots({ left: 0, right: 600 }, [])).toEqual([{ left: 0, right: 600 }]);
	});

	it("carves a single centered blocker into two slots", () => {
		const out = carveTextLineSlots({ left: 0, right: 600 }, [{ left: 200, right: 280 }]);
		expect(out).toEqual([
			{ left: 0, right: 200 },
			{ left: 280, right: 600 },
		]);
	});

	it("drops the left slot when blocker overlaps left edge", () => {
		const out = carveTextLineSlots({ left: 100, right: 600 }, [{ left: 50, right: 200 }]);
		expect(out).toEqual([{ left: 200, right: 600 }]);
	});

	it("returns empty when blocker fully covers base", () => {
		const out = carveTextLineSlots({ left: 100, right: 400 }, [{ left: 50, right: 500 }]);
		expect(out).toEqual([]);
	});

	it("filters slots narrower than minSlotWidth", () => {
		const out = carveTextLineSlots({ left: 0, right: 600 }, [{ left: 30, right: 580 }], 40);
		// Left: width 30 (dropped). Right: width 20 (dropped).
		expect(out).toEqual([]);
	});

	it("handles multiple non-overlapping blockers", () => {
		const out = carveTextLineSlots({ left: 0, right: 1000 }, [
			{ left: 100, right: 200 },
			{ left: 400, right: 500 },
			{ left: 700, right: 800 },
		]);
		expect(out).toEqual([
			{ left: 0, right: 100 },
			{ left: 200, right: 400 },
			{ left: 500, right: 700 },
			{ left: 800, right: 1000 },
		]);
	});
});

// ---------------------------------------------------------------------------
// layoutNextLine
// ---------------------------------------------------------------------------

describe("layoutNextLine", () => {
	it("returns null for empty input", () => {
		expect(layoutNextLine([], { segmentIndex: 0, graphemeIndex: 0 }, 200)).toBeNull();
	});

	it("fits one line when text fits entirely", () => {
		const segs = prep("hello world");
		const line = layoutNextLine(segs, { segmentIndex: 0, graphemeIndex: 0 }, 200);
		expect(line).not.toBeNull();
		expect(line?.text).toBe("hello world");
		expect(line?.end.segmentIndex).toBeGreaterThanOrEqual(segs.length - 1);
	});

	it("breaks at the last pending space when overflowing (trailing space hangs)", () => {
		// Each char 8px → "alpha" = 40, " " = 8. Budget 60 → "alpha " fits (48),
		// "beta" overflows. Break at pending space: line is "alpha " (trailing space hangs).
		const segs = prep("alpha beta gamma");
		const line = layoutNextLine(segs, { segmentIndex: 0, graphemeIndex: 0 }, 60);
		expect(line).not.toBeNull();
		expect(line?.text).toBe("alpha ");
		// Width excludes the hanging trailing space (CSS behavior).
		expect(line?.width).toBe(5 * CHAR_WIDTH);
	});

	it("advances cursor across multiple calls, seamlessly", () => {
		const segs = prep("one two three four five six");
		let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
		const lines: string[] = [];
		for (let i = 0; i < 20; i++) {
			const ln = layoutNextLine(segs, cursor, 60);
			if (ln === null) break;
			lines.push(ln.text);
			cursor = ln.end;
		}
		// Concatenating preserves the source text (trailing spaces hang on wrapped lines).
		expect(lines.join("")).toBe("one two three four five six");
	});

	it("returns an empty line at hard-breaks and advances past them", () => {
		// Manually construct — analyzeAndMeasure normalizes \n to space.
		const segs: PreparedSegment[] = [
			{ text: "line1", width: 40, kind: "text", graphemeWidths: null },
			{ text: "\n", width: 0, kind: "hard-break", graphemeWidths: null },
			{ text: "line2", width: 40, kind: "text", graphemeWidths: null },
		];
		const first = layoutNextLine(segs, { segmentIndex: 0, graphemeIndex: 0 }, 200);
		expect(first?.text).toBe("line1");
		expect(first?.end.segmentIndex).toBe(1);
		const second = layoutNextLine(segs, first!.end, 200);
		// Hard-break at cursor → empty line advancing past it.
		expect(second?.text).toBe("");
		expect(second?.end.segmentIndex).toBe(2);
		const third = layoutNextLine(segs, second!.end, 200);
		expect(third?.text).toBe("line2");
	});

	it("yields null when cursor is past all segments", () => {
		const segs = prep("hi");
		const first = layoutNextLine(segs, { segmentIndex: 0, graphemeIndex: 0 }, 200);
		expect(first).not.toBeNull();
		expect(layoutNextLine(segs, first!.end, 200)).toBeNull();
	});

	it("skips leading whitespace on a fresh line", () => {
		// Start mid-stream at a space-kind segment → skip it, start on the next word.
		const segs = prep("alpha beta");
		// segments: [text("alpha"), space(" "), text("beta")]
		// Start at index 1 (the space) — leading whitespace must be skipped.
		const line = layoutNextLine(segs, { segmentIndex: 1, graphemeIndex: 0 }, 40);
		expect(line?.text).toBe("beta");
		expect(line?.width).toBe(4 * CHAR_WIDTH);
	});
});

// ---------------------------------------------------------------------------
// circleIntervalForBand / rectIntervalForBand
// ---------------------------------------------------------------------------

describe("circleIntervalForBand", () => {
	it("returns null when band is fully above the circle", () => {
		const iv = circleIntervalForBand({ kind: "circle", cx: 100, cy: 200, r: 50 }, 0, 100);
		expect(iv).toBeNull();
	});

	it("returns null when band is fully below the circle", () => {
		const iv = circleIntervalForBand({ kind: "circle", cx: 100, cy: 200, r: 50 }, 300, 400);
		expect(iv).toBeNull();
	});

	it("returns full diameter interval when band passes through center", () => {
		const iv = circleIntervalForBand({ kind: "circle", cx: 100, cy: 200, r: 50 }, 190, 210);
		expect(iv).not.toBeNull();
		expect(iv!.left).toBeCloseTo(50, 5);
		expect(iv!.right).toBeCloseTo(150, 5);
	});

	it("applies padding to the returned interval", () => {
		const iv = circleIntervalForBand(
			{ kind: "circle", cx: 100, cy: 200, r: 50, hPad: 10 },
			190,
			210,
		);
		expect(iv!.left).toBeCloseTo(40, 5);
		expect(iv!.right).toBeCloseTo(160, 5);
	});
});

describe("rectIntervalForBand", () => {
	it("returns null when band is above the rect", () => {
		const iv = rectIntervalForBand({ kind: "rect", x: 100, y: 200, w: 50, h: 50 }, 0, 100);
		expect(iv).toBeNull();
	});

	it("returns the rect's left/right when band intersects", () => {
		const iv = rectIntervalForBand({ kind: "rect", x: 100, y: 200, w: 50, h: 50 }, 220, 230);
		expect(iv).toEqual({ left: 100, right: 150 });
	});
});

// ---------------------------------------------------------------------------
// computeFlowLines (pure)
// ---------------------------------------------------------------------------

describe("computeFlowLines", () => {
	it("lays out a single column with no obstacles", () => {
		const segs = prep("alpha beta gamma delta");
		const { lines } = computeFlowLines(
			segs,
			{ width: 80, height: 200, paddingX: 0, paddingY: 0 },
			{ count: 1, gap: 0 },
			[],
			20,
			10,
		);
		expect(lines.length).toBeGreaterThan(0);
		for (const l of lines) {
			expect(l.x).toBe(0);
			expect(l.columnIndex).toBe(0);
		}
	});

	it("carries the cursor from column 1 to column 2 (no duplication)", () => {
		const segs = prep("one two three four five six seven eight nine ten");
		const { lines } = computeFlowLines(
			segs,
			{ width: 200, height: 40, paddingX: 0, paddingY: 0 },
			{ count: 2, gap: 20 },
			[],
			20,
			10,
		);
		const col0 = lines.filter((l) => l.columnIndex === 0).map((l) => l.text);
		const col1 = lines.filter((l) => l.columnIndex === 1).map((l) => l.text);
		expect(col0.length).toBeGreaterThan(0);
		expect(col1.length).toBeGreaterThan(0);
		// No text appears in both columns
		for (const t of col0) expect(col1).not.toContain(t);
	});

	it("splits a line into two slots around a centered circle obstacle", () => {
		// Long text so both slots at band y=0 are filled (not exhausted early).
		const word = "quick brown fox jumps over the lazy dog and ";
		const segs = prep(word.repeat(8).trim());
		const { lines } = computeFlowLines(
			segs,
			{ width: 600, height: 40, paddingX: 0, paddingY: 0 },
			{ count: 1, gap: 0 },
			[{ kind: "circle", cx: 300, cy: 10, r: 80, hPad: 8 }],
			20,
			20,
		);
		// First band (y=0..20) has two slots carved by the circle — expect lines
		// on both sides of the obstacle at the same y.
		const band = lines.filter((l) => l.y === 0);
		expect(band.length).toBe(2);
		const xs = band.map((l) => l.x).sort((a, b) => a - b);
		expect(xs[0]).toBe(0);
		expect(xs[1]).toBeGreaterThan(300);
	});

	it("reports overflow cursor when container can't fit all text", () => {
		const segs = prep("one two three four five six seven eight nine ten eleven twelve");
		const { lines, cursor } = computeFlowLines(
			segs,
			// Very small container → text truncates.
			{ width: 40, height: 40, paddingX: 0, paddingY: 0 },
			{ count: 1, gap: 0 },
			[],
			20,
			10,
		);
		expect(lines.length).toBeGreaterThan(0);
		// Cursor didn't reach end of segments → overflow.
		expect(cursor.segmentIndex).toBeLessThan(segs.length);
	});

	it("hard-break advances the band (produces visible paragraph gap)", () => {
		// Manually build segments with a hard-break between two words.
		const segs: PreparedSegment[] = [
			{ text: "alpha", width: 40, kind: "text", graphemeWidths: null },
			{ text: "\n", width: 0, kind: "hard-break", graphemeWidths: null },
			{ text: "beta", width: 32, kind: "text", graphemeWidths: null },
		];
		const { lines } = computeFlowLines(
			segs,
			{ width: 400, height: 200, paddingX: 0, paddingY: 0 },
			{ count: 1, gap: 0 },
			[],
			20,
			10,
		);
		expect(lines.map((l) => l.text)).toEqual(["alpha", "beta"]);
		// Paragraph gap: "beta" sits at least 2 line-heights below "alpha".
		const alpha = lines.find((l) => l.text === "alpha");
		const beta = lines.find((l) => l.text === "beta");
		expect(beta!.y - alpha!.y).toBeGreaterThanOrEqual(40);
	});

	it("D7: paragraphSpacing default tracks lineHeight reactively", () => {
		// Pure `computeFlowLines` side: default is lineHeight when opts omitted.
		const segs: PreparedSegment[] = [
			{ text: "alpha", width: 40, kind: "text", graphemeWidths: null },
			{ text: "\n", width: 0, kind: "hard-break", graphemeWidths: null },
			{ text: "beta", width: 32, kind: "text", graphemeWidths: null },
		];
		const container = { width: 400, height: 400, paddingX: 0, paddingY: 0 };
		const columns = { count: 1, gap: 0 };
		// Default (no opts) = lineHeight → beta sits 2 * lineHeight below alpha.
		const outA = computeFlowLines(segs, container, columns, [], 20, 10);
		expect(outA.lines.find((l) => l.text === "beta")!.y).toBe(40);
		const outB = computeFlowLines(segs, container, columns, [], 40, 10);
		// With lineHeight=40 the gap scales: beta at 80 (= one line of alpha + one
		// line-height gap). Proves default "= lineHeight" follows the parameter,
		// not a snapshot.
		expect(outB.lines.find((l) => l.text === "beta")!.y).toBe(80);
	});

	it("D7: paragraphSpacing controls the hard-break gap", () => {
		const segs: PreparedSegment[] = [
			{ text: "alpha", width: 40, kind: "text", graphemeWidths: null },
			{ text: "\n", width: 0, kind: "hard-break", graphemeWidths: null },
			{ text: "beta", width: 32, kind: "text", graphemeWidths: null },
		];
		const container = { width: 400, height: 400, paddingX: 0, paddingY: 0 };
		const columns = { count: 1, gap: 0 };
		// paragraphSpacing: 0 → "beta" is one line-height below "alpha" (no gap).
		const tight = computeFlowLines(segs, container, columns, [], 20, 10, {
			paragraphSpacing: 0,
		}).lines;
		const tightAlpha = tight.find((l) => l.text === "alpha")!;
		const tightBeta = tight.find((l) => l.text === "beta")!;
		expect(tightBeta.y - tightAlpha.y).toBe(20);

		// paragraphSpacing: 60 → "beta" sits 20 (alpha's line) + 60 (gap) below.
		const loose = computeFlowLines(segs, container, columns, [], 20, 10, {
			paragraphSpacing: 60,
		}).lines;
		const looseAlpha = loose.find((l) => l.text === "alpha")!;
		const looseBeta = loose.find((l) => l.text === "beta")!;
		expect(looseBeta.y - looseAlpha.y).toBe(80);
	});
});

// ---------------------------------------------------------------------------
// reactiveFlowLayout (reactive graph)
// ---------------------------------------------------------------------------

describe("reactiveFlowLayout", () => {
	it("initial flow-lines populates on first read", () => {
		const flow = reactiveFlowLayout({
			adapter: mockAdapter(),
			text: "alpha beta gamma delta epsilon",
			font: "16px mono",
			lineHeight: 20,
			container: { width: 80, height: 200 },
			columns: { count: 1, gap: 0 },
		});
		const unsub = flow.flowLines.subscribe(() => {});
		const lines = flow.flowLines.cache;
		expect(Array.isArray(lines)).toBe(true);
		expect((lines as unknown[]).length).toBeGreaterThan(0);
		unsub();
	});

	it("setObstacles re-runs flow-lines but NOT segments (cached)", () => {
		const flow = reactiveFlowLayout({
			adapter: mockAdapter(),
			text: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi",
			font: "16px mono",
			lineHeight: 20,
			container: { width: 400, height: 200 },
			columns: { count: 1, gap: 0 },
		});

		const u1 = flow.segments.subscribe(() => {});
		const u2 = flow.flowLines.subscribe(() => {});

		const segsBefore = flow.segments.cache;
		const linesBefore = flow.flowLines.cache as Array<{ text: string }>;

		flow.setObstacles([{ kind: "circle", cx: 200, cy: 30, r: 80 }]);

		const segsAfter = flow.segments.cache;
		const linesAfter = flow.flowLines.cache as Array<{ text: string }>;

		// Segments unchanged (reference-equal — text/font didn't change).
		expect(segsAfter).toBe(segsBefore);
		// Flow lines re-ran → new array, different layout.
		expect(linesAfter).not.toBe(linesBefore);
		expect(linesAfter.length).toBeGreaterThan(linesBefore.length);

		u1();
		u2();
	});
});

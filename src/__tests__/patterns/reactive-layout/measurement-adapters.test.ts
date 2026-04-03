/**
 * Tests for MeasurementAdapter implementations (roadmap §7.1).
 */
import { describe, expect, it } from "vitest";
import {
	CanvasMeasureAdapter,
	type CanvasModule,
	CliMeasureAdapter,
	NodeCanvasMeasureAdapter,
	PrecomputedAdapter,
} from "../../../patterns/reactive-layout/measurement-adapters.js";
import type { MeasurementAdapter } from "../../../patterns/reactive-layout/reactive-layout.js";
import {
	analyzeAndMeasure,
	reactiveLayout,
} from "../../../patterns/reactive-layout/reactive-layout.js";

// ---------------------------------------------------------------------------
// CliMeasureAdapter
// ---------------------------------------------------------------------------

describe("CliMeasureAdapter", () => {
	it("measures ASCII text as 1 cell per character", () => {
		const adapter = new CliMeasureAdapter();
		expect(adapter.measureSegment("hello", "mono").width).toBe(40); // 5 * 8
	});

	it("measures CJK characters as 2 cells each", () => {
		const adapter = new CliMeasureAdapter();
		// 3 CJK chars → 6 cells → 48px
		expect(adapter.measureSegment("你好世", "mono").width).toBe(48);
	});

	it("measures mixed ASCII + CJK", () => {
		const adapter = new CliMeasureAdapter();
		// "hi你" → 2 ASCII (2 cells) + 1 CJK (2 cells) = 4 cells → 32px
		expect(adapter.measureSegment("hi你", "mono").width).toBe(32);
	});

	it("respects custom cellPx", () => {
		const adapter = new CliMeasureAdapter({ cellPx: 10 });
		expect(adapter.measureSegment("ab", "mono").width).toBe(20);
	});

	it("handles empty string", () => {
		const adapter = new CliMeasureAdapter();
		expect(adapter.measureSegment("", "mono").width).toBe(0);
	});

	it("measures fullwidth forms as 2 cells", () => {
		const adapter = new CliMeasureAdapter();
		// Ａ (U+FF21, fullwidth A) → 2 cells
		expect(adapter.measureSegment("\uff21", "mono").width).toBe(16);
	});

	it("measures Hangul syllables as 2 cells", () => {
		const adapter = new CliMeasureAdapter();
		// 한 (U+D55C) → 2 cells → 16px
		expect(adapter.measureSegment("한", "mono").width).toBe(16);
	});

	it("treats combining marks as zero-width", () => {
		const adapter = new CliMeasureAdapter();
		// "e\u0301" = e + combining acute accent → 1 cell (not 2)
		expect(adapter.measureSegment("e\u0301", "mono").width).toBe(8);
	});

	it("ignores font parameter", () => {
		const adapter = new CliMeasureAdapter();
		const w1 = adapter.measureSegment("test", "12px serif");
		const w2 = adapter.measureSegment("test", "48px monospace");
		expect(w1.width).toBe(w2.width);
	});

	it("integrates with reactiveLayout", () => {
		const adapter = new CliMeasureAdapter({ cellPx: 8 });
		const bundle = reactiveLayout({
			adapter,
			text: "hello world",
			maxWidth: 60,
		});
		// Subscribe to trigger computation
		const unsub = bundle.lineBreaks.subscribe(() => {});
		// "hello" = 40px, " " = 8px, "world" = 40px → total 88px > 60px
		// Should wrap into 2 lines
		const lb = bundle.lineBreaks.get();
		expect(lb).not.toBeNull();
		expect(lb!.lineCount).toBe(2);
		unsub();
		bundle.graph.destroy();
	});
});

// ---------------------------------------------------------------------------
// PrecomputedAdapter
// ---------------------------------------------------------------------------

describe("PrecomputedAdapter", () => {
	const metrics = {
		"16px mono": {
			hello: 40,
			world: 40,
			" ": 8,
			h: 8,
			e: 8,
			l: 8,
			o: 8,
			w: 8,
			r: 8,
			d: 8,
		},
	};

	it("looks up exact segment width", () => {
		const adapter = new PrecomputedAdapter({ metrics });
		expect(adapter.measureSegment("hello", "16px mono").width).toBe(40);
	});

	it("falls back to per-char sum for unknown segments", () => {
		const adapter = new PrecomputedAdapter({ metrics });
		// "held" → h(8) + e(8) + l(8) + d(8) = 32
		expect(adapter.measureSegment("held", "16px mono").width).toBe(32);
	});

	it("returns 0 for completely unknown font", () => {
		const adapter = new PrecomputedAdapter({ metrics });
		expect(adapter.measureSegment("hello", "unknown-font").width).toBe(0);
	});

	it("throws in error mode for unknown segment", () => {
		const adapter = new PrecomputedAdapter({ metrics, fallback: "error" });
		expect(() => adapter.measureSegment("xyz", "16px mono")).toThrow("no metrics");
	});

	it("validates fallback at runtime", () => {
		// Simulate runtime JS misuse: bypass TS unions.
		expect(() => new PrecomputedAdapter({ metrics, fallback: "bogus" as any })).toThrow(
			"fallback must be 'per-char' or 'error'",
		);
	});

	it("returns exact match even in error mode", () => {
		const adapter = new PrecomputedAdapter({ metrics, fallback: "error" });
		expect(adapter.measureSegment("hello", "16px mono").width).toBe(40);
	});

	it("integrates with analyzeAndMeasure", () => {
		const adapter = new PrecomputedAdapter({ metrics });
		const segs = analyzeAndMeasure("hello world", "16px mono", adapter, new Map());
		expect(segs.length).toBeGreaterThan(0);
		const textSegs = segs.filter((s) => s.kind === "text");
		expect(textSegs.length).toBe(2); // "hello", "world"
	});
});

// ---------------------------------------------------------------------------
// NodeCanvasMeasureAdapter (mock canvas module)
// ---------------------------------------------------------------------------

describe("NodeCanvasMeasureAdapter", () => {
	function mockCanvasModule(): CanvasModule {
		return {
			createCanvas(_w: number, _h: number) {
				let currentFont = "";
				return {
					getContext(_type: "2d") {
						return {
							get font() {
								return currentFont;
							},
							set font(f: string) {
								currentFont = f;
							},
							measureText(text: string) {
								// Simple mock: 10px per char
								return { width: text.length * 10 };
							},
						};
					},
				};
			},
		};
	}

	it("measures text via injected canvas module", () => {
		const adapter = new NodeCanvasMeasureAdapter(mockCanvasModule());
		expect(adapter.measureSegment("hello", "16px mono").width).toBe(50);
	});

	it("lazily creates canvas context on first call", () => {
		let createCount = 0;
		const mod: CanvasModule = {
			createCanvas(w, h) {
				createCount++;
				return mockCanvasModule().createCanvas(w, h);
			},
		};
		const adapter = new NodeCanvasMeasureAdapter(mod);
		expect(createCount).toBe(0);
		adapter.measureSegment("a", "mono");
		expect(createCount).toBe(1);
		adapter.measureSegment("b", "mono");
		expect(createCount).toBe(1); // reuses context
	});

	it("sets font on context when font changes", () => {
		const fonts: string[] = [];
		const mod: CanvasModule = {
			createCanvas() {
				let f = "";
				return {
					getContext() {
						return {
							get font() {
								return f;
							},
							set font(v: string) {
								f = v;
								fonts.push(v);
							},
							measureText(text: string) {
								return { width: text.length * 10 };
							},
						};
					},
				};
			},
		};
		const adapter = new NodeCanvasMeasureAdapter(mod);
		adapter.measureSegment("a", "12px serif");
		adapter.measureSegment("b", "12px serif"); // same font, no set
		adapter.measureSegment("c", "16px mono"); // different font
		expect(fonts).toEqual(["12px serif", "16px mono"]);
	});

	it("clearCache resets font tracking", () => {
		const adapter = new NodeCanvasMeasureAdapter(mockCanvasModule());
		adapter.measureSegment("a", "12px serif");
		adapter.clearCache();
		// After clear, next call should set font again even if same
		adapter.measureSegment("b", "12px serif");
		// No error — works correctly
		expect(adapter.measureSegment("c", "12px serif").width).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// CanvasMeasureAdapter (limited test — no OffscreenCanvas in Node)
// ---------------------------------------------------------------------------

describe("CanvasMeasureAdapter", () => {
	it("can be constructed without options", () => {
		// Just verify it doesn't throw at construction time
		const adapter = new CanvasMeasureAdapter();
		expect(adapter).toBeDefined();
	});

	it("can be constructed with emoji correction", () => {
		const adapter = new CanvasMeasureAdapter({ emojiCorrection: 0.85 });
		expect(adapter).toBeDefined();
	});

	// OffscreenCanvas is not available in Node/vitest — skip actual measurement.
	// Integration tests in a browser environment would cover measureSegment().
});

// ---------------------------------------------------------------------------
// All adapters satisfy MeasurementAdapter interface
// ---------------------------------------------------------------------------

describe("MeasurementAdapter interface conformance", () => {
	const adapters: [string, MeasurementAdapter][] = [
		["CliMeasureAdapter", new CliMeasureAdapter()],
		[
			"PrecomputedAdapter",
			new PrecomputedAdapter({
				metrics: { mono: { a: 8 } },
			}),
		],
		[
			"NodeCanvasMeasureAdapter",
			new NodeCanvasMeasureAdapter({
				createCanvas() {
					return {
						getContext() {
							return {
								font: "",
								measureText(t: string) {
									return { width: t.length * 8 };
								},
							};
						},
					};
				},
			}),
		],
	];

	for (const [name, adapter] of adapters) {
		it(`${name} has measureSegment(text, font) → { width: number }`, () => {
			const result = adapter.measureSegment("test", "mono");
			expect(result).toHaveProperty("width");
			expect(typeof result.width).toBe("number");
		});
	}
});

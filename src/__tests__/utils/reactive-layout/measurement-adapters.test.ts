/**
 * Tests for MeasurementAdapter implementations (roadmap §7.1).
 */
import { describe, expect, it } from "vitest";
import {
	_resetDefaultSegmentAdapterForTests,
	CanvasMeasureAdapter,
	type CanvasModule,
	CliMeasureAdapter,
	getDefaultSegmentAdapter,
	InjectedMeasureAdapter,
	IntlSegmentAdapter,
	NodeCanvasMeasureAdapter,
	PrecomputedAdapter,
} from "../../../utils/reactive-layout/measurement-adapters.js";
import type {
	MeasurementAdapter,
	SegmentAdapter,
	SegmentInfo,
} from "../../../utils/reactive-layout/reactive-layout.js";
import {
	analyzeAndMeasure,
	reactiveLayout,
} from "../../../utils/reactive-layout/reactive-layout.js";

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
		const lb = bundle.lineBreaks.cache;
		expect(lb).not.toBeNull();
		expect(lb!.lineCount).toBe(2);
		unsub();
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

// ---------------------------------------------------------------------------
// InjectedMeasureAdapter (RN/Hermes reference adapter)
// ---------------------------------------------------------------------------

describe("InjectedMeasureAdapter", () => {
	it("delegates to the injected sync (text, font) => widthPx fn", () => {
		const calls: Array<[string, string]> = [];
		const adapter = new InjectedMeasureAdapter((text, font) => {
			calls.push([text, font]);
			return text.length * 7;
		});
		expect(adapter.measureSegment("abc", "16px Kalam")).toEqual({ width: 21 });
		expect(calls).toEqual([["abc", "16px Kalam"]]);
	});

	it("satisfies the MeasurementAdapter contract", () => {
		const adapter: MeasurementAdapter = new InjectedMeasureAdapter((t) => t.length);
		const r = adapter.measureSegment("xy", "mono");
		expect(typeof r.width).toBe("number");
	});

	it("caches by font+text when cache:true and clearCache resets it", () => {
		let n = 0;
		const adapter = new InjectedMeasureAdapter(
			(t) => {
				n++;
				return t.length;
			},
			{ cache: true },
		);
		adapter.measureSegment("aa", "f1");
		adapter.measureSegment("aa", "f1"); // cache hit
		expect(n).toBe(1);
		adapter.measureSegment("aa", "f2"); // different font → miss
		expect(n).toBe(2);
		adapter.clearCache();
		adapter.measureSegment("aa", "f1"); // miss after clear
		expect(n).toBe(3);
	});

	it("cache key does not collide across (font, text) boundary shifts", () => {
		// Regression: the cache separator must be collision-safe. A naive
		// space (or an empty/stripped delimiter) collides `(font,text)`
		// pairs whose concatenation is equal — e.g. ("a","bc") vs ("ab","c"),
		// and ("a","b c") vs ("a b","c"). Encode width from BOTH args so a
		// wrong cache hit returns the wrong width.
		let calls = 0;
		const adapter = new InjectedMeasureAdapter(
			(text, font) => {
				calls++;
				return text.length * 1000 + font.length;
			},
			{ cache: true },
		);
		// measureSegment(text, font)
		expect(adapter.measureSegment("bc", "a").width).toBe(2001); // 2*1000+1
		expect(adapter.measureSegment("c", "ab").width).toBe(1002); // 1*1000+2 (NOT 2003)
		expect(adapter.measureSegment("b c", "a").width).toBe(3001); // 3*1000+1
		expect(adapter.measureSegment("c", "a b").width).toBe(1003); // 1*1000+3 (NOT 3001)
		expect(calls).toBe(4); // four distinct keys → four fn calls, no false hit
		// And a genuine repeat IS a hit (no over-keying).
		expect(adapter.measureSegment("bc", "a").width).toBe(2001);
		expect(calls).toBe(4);
	});

	it("does not cache by default (fn called every time)", () => {
		let n = 0;
		const adapter = new InjectedMeasureAdapter(() => {
			n++;
			return 1;
		});
		adapter.measureSegment("a", "f");
		adapter.measureSegment("a", "f");
		expect(n).toBe(2);
	});

	it("works as a reactiveLayout adapter (RN drop-in seam)", () => {
		// Stand-in for a host Skia/RN measure fn: width = chars × 9px.
		// "hello"=45 " "=9 "world"=45 → 99 > 50 ⇒ wraps to 2 lines.
		const bundle = reactiveLayout({
			adapter: new InjectedMeasureAdapter((t) => t.length * 9),
			text: "hello world",
			maxWidth: 50,
		});
		const unsub = bundle.lineBreaks.subscribe(() => {});
		expect(bundle.lineBreaks.cache).not.toBeNull();
		expect(bundle.lineBreaks.cache!.lineCount).toBe(2);
		unsub();
	});

	it("rejects a non-function measure fn", () => {
		expect(() => new InjectedMeasureAdapter(undefined as never)).toThrow(TypeError);
	});
});

// ---------------------------------------------------------------------------
// IntlSegmentAdapter (default reference SegmentAdapter)
//
// DS-2026-05-20 — `optimizations.md` 🟠 (d). Hermes-runtime-gap follow-up:
// these tests pin the cross-port contract (delegate to platform
// `Intl.Segmenter` when present; throw a clear "supply a SegmentAdapter"
// error when absent — the runtime that bit memo:Re Story 3.6).
// ---------------------------------------------------------------------------

describe("IntlSegmentAdapter", () => {
	it("constructs on a runtime with Intl.Segmenter", () => {
		const a = new IntlSegmentAdapter();
		expect(a).toBeInstanceOf(IntlSegmentAdapter);
	});

	it("segmentWords yields { segment, index, isWordLike } matching Intl.Segmenter shape", () => {
		const a = new IntlSegmentAdapter();
		const segs = [...a.segmentWords("hello world")];
		// Expect at least one wordLike + one non-wordLike (space). Be tolerant
		// of Intl.Segmenter implementation-detail boundaries; structural-only.
		expect(segs.length).toBeGreaterThan(0);
		const wordLikes = segs.filter((s) => s.isWordLike === true).map((s) => s.segment);
		expect(wordLikes).toContain("hello");
		expect(wordLikes).toContain("world");
		for (const s of segs) {
			expect(typeof s.segment).toBe("string");
			expect(typeof s.index).toBe("number");
		}
	});

	it("segmentGraphemes yields { segment, index } per grapheme cluster", () => {
		const a = new IntlSegmentAdapter();
		// "a‍‍" is one grapheme; "ab" is two graphemes.
		const ab = [...a.segmentGraphemes("ab")].map((s) => s.segment);
		expect(ab).toEqual(["a", "b"]);
	});

	it("caches per-granularity Intl.Segmenter across calls (allocates once)", () => {
		const a = new IntlSegmentAdapter();
		// Spying on the constructor is brittle; instead, exercise both paths
		// and assert the iterator output stays consistent (same instance
		// behavior). This is a smoke test, not a perf assertion.
		const a1 = [...a.segmentGraphemes("xy")].map((s) => s.segment);
		const a2 = [...a.segmentGraphemes("xy")].map((s) => s.segment);
		expect(a1).toEqual(a2);
		const w1 = [...a.segmentWords("a b")].map((s) => s.segment);
		const w2 = [...a.segmentWords("a b")].map((s) => s.segment);
		expect(w1).toEqual(w2);
	});

	// R-RL-Hermes-2026-05-20: the failure shape memo:Re Story 3.6 hit.
	// Stubbing `Intl.Segmenter` to undefined emulates Hermes / iOS 26.5
	// (where `Intl.Segmenter typeof === "undefined"`). The pre-DS substrate
	// would throw `Cannot read property 'prototype' of undefined` deep in
	// the reactive wave; post-DS, IntlSegmentAdapter throws a clear,
	// recipe-naming TypeError at construction time.
	it("throws a clear TypeError when Intl.Segmenter is undefined (Hermes shape)", () => {
		const orig = (Intl as unknown as { Segmenter: unknown }).Segmenter;
		try {
			(Intl as unknown as { Segmenter: unknown }).Segmenter = undefined;
			expect(() => new IntlSegmentAdapter()).toThrow(TypeError);
			try {
				new IntlSegmentAdapter();
				expect.fail("Expected TypeError");
			} catch (e) {
				expect((e as Error).message).toMatch(/Intl\.Segmenter is not available/);
				expect((e as Error).message).toMatch(/segmentAdapter/);
				expect((e as Error).message).toMatch(/polyfill/i);
			}
		} finally {
			(Intl as unknown as { Segmenter: unknown }).Segmenter = orig;
		}
	});

	it("getDefaultSegmentAdapter returns a lazy, module-shared instance", () => {
		_resetDefaultSegmentAdapterForTests();
		const d1 = getDefaultSegmentAdapter();
		const d2 = getDefaultSegmentAdapter();
		expect(d1).toBe(d2);
		expect(d1).toBeInstanceOf(IntlSegmentAdapter);
	});
});

// ---------------------------------------------------------------------------
// Host-injected SegmentAdapter — end-to-end (the actual Hermes-shape coverage)
// ---------------------------------------------------------------------------

describe("Host-injected SegmentAdapter end-to-end", () => {
	/**
	 * Build a fake SegmentAdapter that does NOT reference `Intl.Segmenter` —
	 * this proves the substrate routes through `opts.segmentAdapter` and
	 * never touches the platform global. On Hermes, a host wires the same
	 * shape over a polyfill (or RN-native segmenter); here we stub the
	 * minimum a polyfill would expose: word + grapheme iteration.
	 */
	function makeFakeSegmentAdapter(): SegmentAdapter & { sawWord: number; sawGrapheme: number } {
		let sawWord = 0;
		let sawGrapheme = 0;
		const adapter: SegmentAdapter & { sawWord: number; sawGrapheme: number } = {
			sawWord: 0,
			sawGrapheme: 0,
			segmentWords(text: string): Iterable<SegmentInfo> {
				sawWord += 1;
				adapter.sawWord = sawWord;
				// Naive word split on space — sufficient for the smoke-test
				// shape; production Hermes consumers wrap a proper polyfill.
				const out: SegmentInfo[] = [];
				let i = 0;
				let acc = "";
				let accStart = 0;
				for (let k = 0; k < text.length; k++) {
					const ch = text[k]!;
					if (ch === " ") {
						if (acc) {
							out.push({ segment: acc, index: accStart, isWordLike: true });
							acc = "";
						}
						out.push({ segment: " ", index: k, isWordLike: false });
						accStart = k + 1;
					} else {
						if (acc === "") accStart = k;
						acc += ch;
					}
					i = k;
				}
				if (acc) out.push({ segment: acc, index: accStart, isWordLike: true });
				void i;
				return out;
			},
			segmentGraphemes(text: string): Iterable<SegmentInfo> {
				sawGrapheme += 1;
				adapter.sawGrapheme = sawGrapheme;
				const out: SegmentInfo[] = [];
				for (let k = 0; k < text.length; k++) {
					out.push({ segment: text[k]!, index: k });
				}
				return out;
			},
		};
		return adapter;
	}

	it("reactiveLayout({ segmentAdapter }) routes through the injected adapter (no Intl.Segmenter access)", () => {
		const fake = makeFakeSegmentAdapter();
		const bundle = reactiveLayout({
			adapter: new InjectedMeasureAdapter((t) => t.length * 9),
			segmentAdapter: fake,
			text: "hello world",
			font: "16px mono",
			maxWidth: 200,
		});
		const unsub = bundle.segments.subscribe(() => {});
		// Adapter must have been consulted at least once for word + grapheme.
		expect(fake.sawWord).toBeGreaterThan(0);
		expect(bundle.segments.cache).not.toBeNull();
		expect((bundle.segments.cache as { text: string }[]).length).toBeGreaterThan(0);
		unsub();
	});

	it("reactiveLayout still works on Hermes-shape runtime when segmentAdapter is supplied (Intl.Segmenter stubbed undefined)", () => {
		// Reset the module-shared default so this test doesn't pick up a
		// previously-constructed live IntlSegmentAdapter.
		_resetDefaultSegmentAdapterForTests();
		const orig = (Intl as unknown as { Segmenter: unknown }).Segmenter;
		try {
			(Intl as unknown as { Segmenter: unknown }).Segmenter = undefined;
			const fake = makeFakeSegmentAdapter();
			// Must NOT throw — substrate never reaches `Intl.Segmenter` because
			// `segmentAdapter` short-circuits `getDefaultSegmentAdapter()`.
			const bundle = reactiveLayout({
				adapter: new InjectedMeasureAdapter((t) => t.length * 9),
				segmentAdapter: fake,
				text: "hello world",
				font: "16px mono",
				maxWidth: 200,
			});
			const unsub = bundle.segments.subscribe(() => {});
			expect(fake.sawWord).toBeGreaterThan(0);
			expect(bundle.segments.cache).not.toBeNull();
			unsub();
		} finally {
			(Intl as unknown as { Segmenter: unknown }).Segmenter = orig;
			_resetDefaultSegmentAdapterForTests();
		}
	});

	it("reactiveLayout({}) without segmentAdapter on Hermes-shape runtime throws the clear-message TypeError at factory construction", () => {
		_resetDefaultSegmentAdapterForTests();
		const orig = (Intl as unknown as { Segmenter: unknown }).Segmenter;
		try {
			(Intl as unknown as { Segmenter: unknown }).Segmenter = undefined;
			expect(() =>
				reactiveLayout({
					adapter: new InjectedMeasureAdapter((t) => t.length * 9),
					text: "hello",
					font: "16px mono",
					maxWidth: 100,
				}),
			).toThrow(/Intl\.Segmenter is not available/);
		} finally {
			(Intl as unknown as { Segmenter: unknown }).Segmenter = orig;
			_resetDefaultSegmentAdapterForTests();
		}
	});

	it("analyzeAndMeasure(segmentAdapter) is honored when explicitly passed", () => {
		const fake = makeFakeSegmentAdapter();
		const adapter: MeasurementAdapter = {
			measureSegment: (t) => ({ width: t.length * 9 }),
		};
		const segs = analyzeAndMeasure("hello world", "16px mono", adapter, new Map(), undefined, fake);
		expect(segs.length).toBeGreaterThan(0);
		expect(fake.sawWord).toBeGreaterThan(0);
	});
});

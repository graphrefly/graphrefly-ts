import { monotonicNs } from "@graphrefly/graphrefly/core";
import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import {
	analyzeAndMeasure,
	computeCharPositions,
	computeLineBreaks,
	type LineBreaksResult,
	type MeasurementAdapter,
	type PreparedSegment,
	type ReactiveLayoutBundle,
	reactiveLayout,
} from "@graphrefly/graphrefly/reactive-layout";
import { getMeasurementAdapter, LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../measure-adapter.js";

export const RECOMPUTES_SOURCE = `// Reactive mode — incremental recompute via equals + per-dep fan-out.
const layout = reactiveLayout({ adapter, text, font, lineHeight, maxWidth });

// When only \`max-width\` changes:
//   state(max-width) emits DATA
//     → line-breaks re-runs  (maxWidth is a dep)
//     → height re-runs       (downstream of line-breaks)
//     → char-positions re-runs
//   \`segments\` does NOT re-run — its deps (text, font) didn't change.

// Baseline (no-reactive) mode — one function call, everything reruns.
function baseline(text, font, mw, lh) {
  const segs  = analyzeAndMeasure(text, font, adapter, new Map());
  const lines = computeLineBreaks(segs, mw, adapter, font, new Map());
  const chars = computeCharPositions(lines, segs, lh);
  return { segs, lines, chars };
}
`;

/**
 * Imperative baseline: re-run the whole pipeline from scratch for every
 * input change. Counters track how many times each stage fires. The point
 * is NOT to show we beat raw analysis speed — the `analyzeAndMeasure` code
 * is ported from Pretext and is roughly the same wall-clock. The point is
 * that reactive fan-out elides the stages whose inputs didn't change.
 */
export type BaselineStats = {
	segmentsRuns: number;
	lineBreaksRuns: number;
	heightRuns: number;
	charPositionsRuns: number;
	lastWallNs: bigint;
};

export function runBaseline(
	text: string,
	font: string,
	maxWidth: number,
	lineHeight: number,
	stats: BaselineStats,
): { segments: PreparedSegment[]; lineBreaks: LineBreaksResult; height: number } {
	const adapter = getMeasurementAdapter();
	const t0 = monotonicNs();
	const segments = analyzeAndMeasure(text, font, adapter, new Map());
	stats.segmentsRuns += 1;
	const lineBreaks = computeLineBreaks(segments, maxWidth, adapter, font, new Map());
	stats.lineBreaksRuns += 1;
	const height = lineBreaks.lineCount * lineHeight;
	stats.heightRuns += 1;
	computeCharPositions(lineBreaks, segments, lineHeight);
	stats.charPositionsRuns += 1;
	stats.lastWallNs = monotonicNs() - t0;
	return { segments, lineBreaks, height };
}

export type ReactiveStats = {
	segmentsRuns: number;
	lineBreaksRuns: number;
	heightRuns: number;
	charPositionsRuns: number;
	lastWallNs: bigint;
};

/**
 * Wrap a reactive bundle with per-derived-node fire counters. Each counter
 * increments only when its node actually pushes DATA (equals short-circuit
 * already absorbed — we count from the outside).
 *
 * `lastWallNs` is set by the caller via {@link timedReactive} below, because
 * subscribing to `segments` alone can't see the "dragging max-width" cascade
 * where `segments` never re-runs — an earlier version tried that and the
 * reported time kept growing with wall-clock time between edits.
 */
export function instrumentReactive(bundle: ReactiveLayoutBundle, stats: ReactiveStats): () => void {
	const unsubs: Array<() => void> = [];
	unsubs.push(
		bundle.segments.subscribe(() => {
			stats.segmentsRuns += 1;
		}),
	);
	unsubs.push(
		bundle.lineBreaks.subscribe(() => {
			stats.lineBreaksRuns += 1;
		}),
	);
	unsubs.push(
		bundle.height.subscribe(() => {
			stats.heightRuns += 1;
		}),
	);
	unsubs.push(
		bundle.charPositions.subscribe(() => {
			stats.charPositionsRuns += 1;
		}),
	);
	return () => {
		for (const u of unsubs) u();
	};
}

/**
 * Run `mutate()` and record the wall-clock time the reactive cascade took to
 * settle. The reactive protocol fires subscribers synchronously during a
 * `.set()`, so wrapping the setter in a `monotonicNs()` pair captures the
 * full propagation window — whichever nodes happened to re-run this tick.
 */
export function timedReactive(stats: ReactiveStats, mutate: () => void): void {
	const t0 = monotonicNs();
	mutate();
	stats.lastWallNs = monotonicNs() - t0;
}

export type RecomputesChapter = {
	bundle: ReactiveLayoutBundle;
	reactiveStats: ReactiveStats;
	baselineStats: BaselineStats;
	resetStats: () => void;
	sourceCode: string;
	registry: NodeRegistry;
	adapter: MeasurementAdapter;
};

export function buildRecomputesChapter(): RecomputesChapter {
	const adapter = getMeasurementAdapter();
	const bundle = reactiveLayout({
		adapter,
		name: "layout.recomputes",
		text: "Drag the width slider to see only line-breaks + downstream re-run. Type to see segments recompute as well.",
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 520,
	});

	const reactiveStats: ReactiveStats = {
		segmentsRuns: 0,
		lineBreaksRuns: 0,
		heightRuns: 0,
		charPositionsRuns: 0,
		lastWallNs: 0n,
	};
	const baselineStats: BaselineStats = {
		segmentsRuns: 0,
		lineBreaksRuns: 0,
		heightRuns: 0,
		charPositionsRuns: 0,
		lastWallNs: 0n,
	};

	instrumentReactive(bundle, reactiveStats);

	const resetStats = () => {
		reactiveStats.segmentsRuns = 0;
		reactiveStats.lineBreaksRuns = 0;
		reactiveStats.heightRuns = 0;
		reactiveStats.charPositionsRuns = 0;
		reactiveStats.lastWallNs = 0n;
		baselineStats.segmentsRuns = 0;
		baselineStats.lineBreaksRuns = 0;
		baselineStats.heightRuns = 0;
		baselineStats.charPositionsRuns = 0;
		baselineStats.lastWallNs = 0n;
	};

	// Push-on-subscribe replays DATA to every subscriber, bumping each reactive
	// counter to 1 before any user action. Reset immediately so the delta the
	// chapter advertises (reactive vs baseline) starts at 0/0/0/0, not 1/1/1/1.
	resetStats();

	const registry: NodeRegistry = new Map([
		["text", { codeLine: 2, visualSelector: "[data-field='recomputes.text']" }],
		["font", { codeLine: 2, visualSelector: "[data-field='recomputes.font']" }],
		["line-height", { codeLine: 2, visualSelector: "[data-field='recomputes.lh']" }],
		["max-width", { codeLine: 2, visualSelector: "[data-field='recomputes.mw']" }],
		["segments", { codeLine: 9, visualSelector: "[data-counter='segments']" }],
		["line-breaks", { codeLine: 6, visualSelector: "[data-counter='line-breaks']" }],
		["height", { codeLine: 7, visualSelector: "[data-counter='height']" }],
		["char-positions", { codeLine: 8, visualSelector: "[data-counter='char-positions']" }],
	]);

	return {
		bundle,
		reactiveStats,
		baselineStats,
		resetStats,
		sourceCode: RECOMPUTES_SOURCE,
		registry,
		adapter,
	};
}

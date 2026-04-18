// Shared reactive-layout integration for the compat-matrix demos.
//
// Three thin helpers that match the three reactive-layout wins:
//
// (1) `getMeasurementAdapter()` — a lazily-created browser
//     `CanvasMeasureAdapter` to pass into `demoShell({ adapter })`. With an
//     adapter present, demoShell exposes `layout/code-lines` (and
//     `layout/graph-labels`) derived nodes that recompute reactively when
//     either the code text OR the side-pane width changes.
//
// (2) `createLeaderboardLayout()` — a `reactiveBlockLayout` bundle for the
//     four leaderboard rows. For this demo it's plumbing-only (four rows
//     don't need dynamic positioning) but the exposed `totalHeight` node
//     is what you'd subscribe to for an auto-sized container when the
//     list grows or rows wrap.
//
// (3) `hitTestCharacter()` — wraps `computeCharPositions` so a framework
//     can answer "which grapheme did the user click on?" against the
//     current `layout/code-lines` and the raw snippet text.

import {
	analyzeAndMeasure,
	CanvasMeasureAdapter,
	type CharPosition,
	computeCharPositions,
	computeLineBreaks,
	type ContentBlock,
	type LineBreaksResult,
	type MeasurementAdapter,
	type Node,
	reactiveBlockLayout,
} from "@graphrefly/graphrefly/patterns/reactive-layout";

/** Font string shared across shell measurements + per-framework renders. */
export const LAYOUT_FONT = '13px "Fira Code", ui-monospace, monospace';
export const LAYOUT_LINE_HEIGHT = 20;

let adapterSingleton: MeasurementAdapter | null = null;
/** Lazy singleton — `OffscreenCanvas` reuse keeps font switching cheap. */
export function getMeasurementAdapter(): MeasurementAdapter {
	if (!adapterSingleton) adapterSingleton = new CanvasMeasureAdapter();
	return adapterSingleton;
}

/** Compact summary of the shell's `layout/code-lines` node for UI display. */
export type CodeLayoutSummary = { lineCount: number; maxWidth: number };
export function summarizeCodeLines(info: LineBreaksResult | null): CodeLayoutSummary {
	if (!info) return { lineCount: 0, maxWidth: 0 };
	const maxWidth = info.lines.reduce((max, l) => Math.max(max, l.width), 0);
	return { lineCount: info.lineCount, maxWidth: Math.round(maxWidth) };
}

// ── (#2) Leaderboard block layout ─────────────────────────────────────

/**
 * Build a `reactiveBlockLayout` bundle for the leaderboard rows. Returns
 * the `totalHeight` node (useful for auto-sizing the leaderboard
 * container) plus a `setBlocks` setter the caller invokes when the list
 * of keys changes.
 */
export function createLeaderboardLayout(initialLabels: readonly string[]): {
	setBlocks: (labels: readonly string[]) => void;
	totalHeight: Node<number>;
} {
	const bundle = reactiveBlockLayout({
		adapters: { text: getMeasurementAdapter() },
		defaultFont: LAYOUT_FONT,
		defaultLineHeight: 28,
		maxWidth: 320,
	});
	const toBlocks = (labels: readonly string[]): ContentBlock[] =>
		labels.map<ContentBlock>((l) => ({ type: "text", text: l }));
	bundle.setBlocks(toBlocks(initialLabels));
	return {
		setBlocks: (labels) => bundle.setBlocks(toBlocks(labels)),
		totalHeight: bundle.totalHeight,
	};
}

// ── (#3) Code-pane char-position hit-testing ──────────────────────────

export type CharHit = {
	line: number;
	/** Zero-based grapheme index within the rendered layout. */
	graphemeIndex: number;
	/** Position of the matched grapheme, for drawing highlights. */
	position: CharPosition;
};

/**
 * Find the grapheme nearest to (localX, localY) in a rendered code pane.
 * `localX`/`localY` are pixels relative to the top-left of the code text
 * (i.e. after subtracting any container padding / header offset).
 *
 * Pure function — no DOM. Framework code measures the container's bounding
 * rect once per click and subtracts the text's own offset before calling.
 */
export function hitTestCharacter(
	text: string,
	maxWidth: number,
	localX: number,
	localY: number,
): CharHit | null {
	if (!text) return null;
	const adapter = getMeasurementAdapter();
	const cache = new Map<string, Map<string, number>>();
	const segments = analyzeAndMeasure(text, LAYOUT_FONT, adapter, cache);
	const lineBreaks = computeLineBreaks(
		segments,
		Math.max(100, maxWidth),
		adapter,
		LAYOUT_FONT,
		cache,
	);
	const positions = computeCharPositions(lineBreaks, segments, LAYOUT_LINE_HEIGHT);
	if (positions.length === 0) return null;
	let best: { hit: CharHit; dist: number } | null = null;
	for (let i = 0; i < positions.length; i++) {
		const p = positions[i];
		const midX = p.x + p.width / 2;
		const midY = p.y + p.height / 2;
		const dist = Math.hypot(midX - localX, midY - localY);
		if (!best || dist < best.dist) {
			best = { hit: { line: p.line, graphemeIndex: i, position: p }, dist };
		}
	}
	return best?.hit ?? null;
}

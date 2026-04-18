import { batch } from "@graphrefly/graphrefly/core";
import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import { type ReactiveLayoutBundle, reactiveLayout } from "@graphrefly/graphrefly/reactive-layout";
import { getMeasurementAdapter, LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../measure-adapter.js";

export const BATCH_SOURCE = `// Unbatched — 5 writes fan out as 5 separate recompute cycles.
layout.setText("five");
layout.setFont("12px Inter");
layout.setLineHeight(18);
layout.setMaxWidth(300);
layout.setText("five — final");
// → segments runs 3×, line-breaks runs 4×, height runs 4×, char-positions 4×.

// Batched — same writes inside one \`batch(...)\` call.
batch(() => {
  layout.setText("five");
  layout.setFont("12px Inter");
  layout.setLineHeight(18);
  layout.setMaxWidth(300);
  layout.setText("five — final");
});
// → segments runs 1×, line-breaks runs 1×, height runs 1×, char-positions 1×.
//   Core defers every DATA emission until the batch's exit tick;
//   equals short-circuit + one-shot fan-out do the rest.
`;

export type BatchStats = {
	segmentsRuns: number;
	lineBreaksRuns: number;
};

export type BatchChapter = {
	batched: ReactiveLayoutBundle;
	unbatched: ReactiveLayoutBundle;
	batchedStats: BatchStats;
	unbatchedStats: BatchStats;
	resetStats: () => void;
	/** Apply the same 5 interleaved writes to both bundles; batched wraps in `batch(...)`. */
	applyFiveEdits: () => void;
	sourceCode: string;
	registry: NodeRegistry;
};

export function buildBatchChapter(): BatchChapter {
	const adapter = getMeasurementAdapter();

	const unbatched = reactiveLayout({
		adapter,
		name: "layout.unbatched",
		text: "Baseline: 5 sequential writes fan out to 5 recompute cycles.",
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 420,
	});

	const batched = reactiveLayout({
		adapter,
		name: "layout.batched",
		text: "Wrapped in batch(): same 5 writes collapse into 1 cycle.",
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 420,
	});

	const batchedStats: BatchStats = { segmentsRuns: 0, lineBreaksRuns: 0 };
	const unbatchedStats: BatchStats = { segmentsRuns: 0, lineBreaksRuns: 0 };

	batched.segments.subscribe(() => {
		batchedStats.segmentsRuns += 1;
	});
	batched.lineBreaks.subscribe(() => {
		batchedStats.lineBreaksRuns += 1;
	});
	unbatched.segments.subscribe(() => {
		unbatchedStats.segmentsRuns += 1;
	});
	unbatched.lineBreaks.subscribe(() => {
		unbatchedStats.lineBreaksRuns += 1;
	});

	const resetStats = () => {
		batchedStats.segmentsRuns = 0;
		batchedStats.lineBreaksRuns = 0;
		unbatchedStats.segmentsRuns = 0;
		unbatchedStats.lineBreaksRuns = 0;
	};

	// Push-on-subscribe replays DATA once per subscriber at attach time, bumping
	// each counter to 1. Reset here so the chapter's teaching story starts at
	// 0/0 before the user clicks — otherwise the first click reports 2/6 instead
	// of the intended 1/5.
	resetStats();

	let nonce = 0;
	const applyFiveEdits = () => {
		nonce += 1;
		const writes = (b: ReactiveLayoutBundle) => {
			b.setText(`edit-${nonce}a`);
			b.setFont(nonce % 2 === 0 ? LAYOUT_FONT : '15px "Fira Code", monospace');
			b.setLineHeight(nonce % 2 === 0 ? 22 : 24);
			b.setMaxWidth(380 + (nonce % 4) * 30);
			b.setText(`edit-${nonce}e — final text for this round`);
		};
		writes(unbatched);
		batch(() => writes(batched));
	};

	// The shell's topology pane renders the BATCHED bundle, so registry
	// entries target the batched section of the source (lines 11–15 are the
	// batched setX calls inside `batch(() => ...)`, line 17 is the cascade
	// claim "→ segments runs 1×, line-breaks runs 1×, height runs 1×, ...").
	const registry: NodeRegistry = new Map([
		["text", { codeLine: 11, visualSelector: "[data-field='batched.text']" }],
		["font", { codeLine: 12, visualSelector: "[data-field='batched.font']" }],
		["line-height", { codeLine: 13, visualSelector: "[data-field='batched.lh']" }],
		["max-width", { codeLine: 14, visualSelector: "[data-field='batched.mw']" }],
		["segments", { codeLine: 17, visualSelector: "[data-counter='batched.segments']" }],
		["line-breaks", { codeLine: 17, visualSelector: "[data-counter='batched.line-breaks']" }],
		["height", { codeLine: 17, visualSelector: "[data-counter='batched.height']" }],
		["char-positions", { codeLine: 17, visualSelector: "[data-counter='batched.char-positions']" }],
	]);

	return {
		batched,
		unbatched,
		batchedStats,
		unbatchedStats,
		resetStats,
		applyFiveEdits,
		sourceCode: BATCH_SOURCE,
		registry,
	};
}

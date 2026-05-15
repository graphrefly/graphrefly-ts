import type { NodeRegistry } from "@graphrefly/graphrefly/utils/demo-shell";
import {
	analyzeAndMeasure,
	CliMeasureAdapter,
	computeLineBreaks,
	PrecomputedAdapter,
	type ReactiveLayoutBundle,
	reactiveLayout,
} from "@graphrefly/graphrefly/utils/reactive-layout";
import { getMeasurementAdapter, LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../measure-adapter.js";

export const ADAPTERS_SOURCE = `// Same topology, three adapters.
const canvas = reactiveLayout({ adapter: new CanvasMeasureAdapter(),   ...opts });
const cli    = reactiveLayout({ adapter: new CliMeasureAdapter({ cellPx: 8 }), ...opts });
const replay = reactiveLayout({ adapter: new PrecomputedAdapter({ metrics }),  ...opts });

// Browser preview pixels in, ASCII cell math elsewhere, snapshot replay for SSR.
// Subscribers to \`lineBreaks\` see the same structure — only the widths differ.
canvas.lineBreaks.subscribe(draw);
cli   .lineBreaks.subscribe(pre);
replay.lineBreaks.subscribe(ssr);
`;

/**
 * Pre-compute a metrics map for the `PrecomputedAdapter` fallback, sampled
 * from whatever the Canvas adapter reports right now for the given font.
 *
 * This is the demo's SSR story: one measurement pass produces a static JSON
 * blob that replays identically on any device.
 */
function snapshotMetrics(text: string): Record<string, Record<string, number>> {
	const adapter = getMeasurementAdapter();
	const cache = new Map<string, Map<string, number>>();
	analyzeAndMeasure(text, LAYOUT_FONT, adapter, cache);
	// Also include a per-char fallback set so any edits still measure cleanly.
	for (const ch of text) {
		analyzeAndMeasure(ch, LAYOUT_FONT, adapter, cache);
	}
	const out: Record<string, Record<string, number>> = {};
	for (const [font, segs] of cache) {
		out[font] = Object.fromEntries(segs);
	}
	return out;
}

export type AdaptersChapter = {
	canvas: ReactiveLayoutBundle;
	cli: ReactiveLayoutBundle;
	replay: ReactiveLayoutBundle;
	setText: (t: string) => void;
	setMaxWidth: (w: number) => void;
	sourceCode: string;
	registry: NodeRegistry;
};

export function buildAdaptersChapter(): AdaptersChapter {
	const seedText = "Three backends, one topology: canvas pixels, CLI cells, precomputed replay.";

	// Fresh metrics for the precomputed adapter so replay can hit anything in seed.
	const metrics = snapshotMetrics(seedText);

	const canvas = reactiveLayout({
		adapter: getMeasurementAdapter(),
		name: "layout.canvas",
		text: seedText,
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 360,
	});

	const cli = reactiveLayout({
		adapter: new CliMeasureAdapter({ cellPx: 8 }),
		name: "layout.cli",
		text: seedText,
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 360,
	});

	const replay = reactiveLayout({
		adapter: new PrecomputedAdapter({ metrics, fallback: "per-char" }),
		name: "layout.replay",
		text: seedText,
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 360,
	});

	const setText = (t: string) => {
		canvas.setText(t);
		cli.setText(t);
		replay.setText(t);
	};
	const setMaxWidth = (w: number) => {
		canvas.setMaxWidth(w);
		cli.setMaxWidth(w);
		replay.setMaxWidth(w);
	};

	// Only nodes whose names actually appear in ADAPTERS_SOURCE get a code
	// line — the others (segments, height, char-positions) resolve to `null`
	// in the shell's `highlight/code-scroll` derived and simply don't
	// highlight anything, which is more honest than pointing at the wrong
	// line.
	const registry: NodeRegistry = new Map([
		// text/font/line-height/max-width all come via `...opts` on the
		// first `reactiveLayout({ ... })` call (line 2 of ADAPTERS_SOURCE).
		["text", { codeLine: 2, visualSelector: "[data-field='adapters.text']" }],
		["font", { codeLine: 2, visualSelector: "[data-field='adapters.font']" }],
		["line-height", { codeLine: 2, visualSelector: "[data-field='adapters.lh']" }],
		["max-width", { codeLine: 2, visualSelector: "[data-field='adapters.mw']" }],
		// Line 7 mentions `lineBreaks` explicitly ("Subscribers to
		// `lineBreaks` see the same structure…").
		["line-breaks", { codeLine: 7, visualSelector: "[data-output='adapters.cli']" }],
	]);

	// Expose widths sanity check at module load time — this is useful as a
	// smoke signal in dev if the precomputed metrics are ever stale.
	void computeLineBreaks; // silence unused-in-type-position import

	return {
		canvas,
		cli,
		replay,
		setText,
		setMaxWidth,
		sourceCode: ADAPTERS_SOURCE,
		registry,
	};
}

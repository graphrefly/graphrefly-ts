import type { Graph } from "@graphrefly/graphrefly";
import type { NodeRegistry } from "@graphrefly/graphrefly/utils/demo-shell";
import {
	type ReactiveLayoutBundle,
	reactiveLayout,
} from "@graphrefly/graphrefly/utils/reactive-layout";
import { getMeasurementAdapter, LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../measure-adapter.js";

export const PLAYGROUND_SOURCE = `// Create one reactive-layout graph. The 4 state inputs are the knobs;
// the 4 derived outputs auto-recompute only along the paths they feed.
const layout = reactiveLayout({
  adapter:    new CanvasMeasureAdapter(),
  text:       "GraphReFly — reactive text layout. 中文也能流畅分行。",
  font:       "14px Fira Code",
  lineHeight: 22,
  maxWidth:   480,
});

// Edit text  → segments + line-breaks + height + char-positions recompute.
// Edit font  → same cascade — measurement cache reseeded per font.
// Drag width → line-breaks + height + char-positions recompute;
//              \`segments\` is cache-hit and doesn't re-run.
// Edit line-height → only height + char-positions recompute.
layout.setText("Try typing here.");
layout.setMaxWidth(320);

// Subscribe reactively — no timer, no re-read pattern.
layout.lineBreaks.subscribe(([[type, v]]) => { if (type === DATA) render(v); });
`;

export type PlaygroundChapter = {
	graph: Graph;
	sourceCode: string;
	registry: NodeRegistry;
	bundles: ReactiveLayoutBundle[];
};

/**
 * Three independent `reactiveLayout` bundles share one measurement adapter
 * (and its cache). The chapter's "demo graph" is the first bundle's graph —
 * side mermaid + inspect pane observe it. The other two render in the main
 * pane to make the multi-consumer fan-out feel real.
 */
export function buildPlaygroundChapter(): PlaygroundChapter {
	const adapter = getMeasurementAdapter();

	const intro = reactiveLayout({
		adapter,
		name: "layout.intro",
		text: "GraphReFly — text layout as a reactive graph. Change inputs, only the dependent derived nodes re-run.",
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 480,
	});

	const cjk = reactiveLayout({
		adapter,
		name: "layout.cjk",
		text: "中文也能流畅分行：标点不会出现在行首，CJK 字符按字形分割。Mixed scripts 同样正常。",
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 480,
	});

	const emoji = reactiveLayout({
		adapter,
		name: "layout.emoji",
		text: "Emoji 🚀, soft-hy­phens, and URLs like https://graphrefly.dev all keep their break points.",
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		maxWidth: 480,
	});

	// Node registry maps hoverable node names (as they appear in `describe()`
	// of `intro.graph`) to the code line and the DOM element in the main pane.
	// Source lines are 1-based, counted from PLAYGROUND_SOURCE above. Each
	// derived output maps to the cascade-comment line that names it explicitly.
	const registry: NodeRegistry = new Map([
		["text", { codeLine: 5, visualSelector: "[data-field='intro.text']" }],
		["font", { codeLine: 6, visualSelector: "[data-field='intro.font']" }],
		["line-height", { codeLine: 7, visualSelector: "[data-field='intro.line-height']" }],
		["max-width", { codeLine: 8, visualSelector: "[data-field='intro.max-width']" }],
		// Line 14 is the only comment that singles out `segments` by name
		// ("`segments` is cache-hit and doesn't re-run").
		["segments", { codeLine: 14, visualSelector: "[data-output='intro.segments']" }],
		// Line 13 mentions line-breaks in the width-drag cascade.
		["line-breaks", { codeLine: 13, visualSelector: "[data-output='intro.lines']" }],
		// Line 15 describes when height/char-positions re-run.
		["height", { codeLine: 15, visualSelector: "[data-output='intro.height']" }],
		["char-positions", { codeLine: 15, visualSelector: "[data-output='intro.positions']" }],
	]);

	return {
		graph: intro.graph,
		sourceCode: PLAYGROUND_SOURCE,
		registry,
		bundles: [intro, cjk, emoji],
	};
}

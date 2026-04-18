import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import {
	type ContentBlock,
	type ReactiveBlockLayoutBundle,
	reactiveBlockLayout,
	SvgBoundsAdapter,
} from "@graphrefly/graphrefly/reactive-layout";
import { getMeasurementAdapter, LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../measure-adapter.js";

export const BLOCKS_SOURCE = `// Mixed content as a reactive graph.
const layout = reactiveBlockLayout({
  adapters: { text: new CanvasMeasureAdapter() },
  defaultFont:       "14px Fira Code",
  defaultLineHeight: 22,
  maxWidth: 520,
  gap: 16,
  blocks: [
    { type: "text",  text: "A heading over the image." },
    { type: "svg",   content: "<svg viewBox='0 0 160 48'>…</svg>" },
    { type: "image", src: "hero.png", naturalWidth: 480, naturalHeight: 270 },
    { type: "text",  text: "A caption paragraph that can wrap." },
  ],
});

// Drag the width slider:
//   state(max-width) emits
//     → measured-blocks re-runs (constraint fed to each block)
//     → block-flow re-runs      (y positions shift)
//     → total-height re-runs    (single number)
// Swap blocks (\`setBlocks\`) → same cascade, no container re-layout.
`;

export type BlocksChapter = {
	bundle: ReactiveBlockLayoutBundle;
	setMaxWidth: (w: number) => void;
	sourceCode: string;
	registry: NodeRegistry;
};

export function buildBlocksChapter(): BlocksChapter {
	const initialBlocks: ContentBlock[] = [
		{
			type: "text",
			text: "Mixed content layout — the heading before the art.",
			font: '16px "Fira Code", monospace',
			lineHeight: 24,
		},
		{
			// Natural dimensions intentionally larger than any slider value so
			// the block always scales down to the container — letting the user
			// watch the SVG + the caption below reflow together.
			type: "svg",
			content: `<svg viewBox="0 0 1200 360" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" x2="1">
      <stop offset="0" stop-color="#4de8c2"/>
      <stop offset="1" stop-color="#9b59b6"/>
    </linearGradient>
  </defs>
  <rect x="24" y="24" width="1152" height="312" rx="28" fill="url(#g)" opacity="0.35"/>
  <text x="600" y="210" font-size="96" text-anchor="middle" fill="#f0f4ff"
        font-family="Fira Code, monospace">reactive-block-layout</text>
</svg>`,
		},
		{
			type: "text",
			text: "A caption that wraps whenever you drag the width slider. Width constraints cascade into each block's measurement, then into the vertical flow.",
		},
		{
			type: "image",
			src: "placeholder.png",
			// Same idea: natural width > slider max so the ratio always binds.
			naturalWidth: 1200,
			naturalHeight: 450,
		},
	];

	const bundle = reactiveBlockLayout({
		adapters: {
			text: getMeasurementAdapter(),
			// Parse the inline SVG viewBox — no DOM, no async, pure string regex.
			svg: new SvgBoundsAdapter(),
		},
		name: "layout.blocks",
		blocks: initialBlocks,
		maxWidth: 520,
		gap: 14,
		defaultFont: LAYOUT_FONT,
		defaultLineHeight: LAYOUT_LINE_HEIGHT,
	});

	// Lines counted against BLOCKS_SOURCE above (1-based). Earlier versions
	// were off-by-one throughout; every entry below maps to the line whose
	// text contains the node's name.
	const registry: NodeRegistry = new Map([
		["blocks", { codeLine: 8, visualSelector: "[data-block='all']" }],
		["max-width", { codeLine: 6, visualSelector: "[data-field='blocks.mw']" }],
		["gap", { codeLine: 7, visualSelector: "[data-field='blocks.gap']" }],
		["measured-blocks", { codeLine: 18, visualSelector: "[data-block='all']" }],
		["block-flow", { codeLine: 19, visualSelector: "[data-block='all']" }],
		["total-height", { codeLine: 20, visualSelector: "[data-block-total]" }],
	]);

	return {
		bundle,
		setMaxWidth: (w: number) => bundle.setMaxWidth(w),
		sourceCode: BLOCKS_SOURCE,
		registry,
	};
}

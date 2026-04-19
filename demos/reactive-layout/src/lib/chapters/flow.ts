import type { Graph } from "@graphrefly/graphrefly/graph";
import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import {
	type FlowContainer,
	type Obstacle,
	type ReactiveFlowLayoutBundle,
	reactiveFlowLayout,
} from "@graphrefly/graphrefly/reactive-layout";
import { getMeasurementAdapter, LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../measure-adapter.js";

export const FLOW_SOURCE = `// Multi-column text that wraps around moving ASCII obstacles.
const flow = reactiveFlowLayout({
  adapter:    new CanvasMeasureAdapter(),
  text:       essay,
  font:       "14px Fira Code",
  lineHeight: 22,
  container:  { width: 620, height: 540, paddingX: 20, paddingY: 16 },
  columns:    { count: 2, gap: 28 },
  obstacles: [
    { kind: "circle", cx: 170, cy: 140, r: 52, hPad: 8 },
    { kind: "circle", cx: 440, cy: 300, r: 44, hPad: 8 },
    { kind: "rect",   x: 260, y: 430, w: 120, h: 62, hPad: 8 },
  ],
});

// Drive drift reactively via fromRaf(). Each tick reads current obstacles
// from the graph, computes bounce, and writes back via flow.setObstacles.
// \`segments\` stays cached (text unchanged); only \`flow-lines\` re-runs.
fromRaf().subscribe(([[, t]]) => {
  flow.setObstacles(driftObstacles(flow.graph.get("obstacles"), t));
});

// The cursor carries across slots AND columns — no duplicated text
// at column handoff, no gap, no per-line cost for adding obstacles.
`;

const FLOW_CONTAINER: FlowContainer = {
	width: 620,
	height: 540,
	paddingX: 20,
	paddingY: 16,
};

export type FlowChapter = {
	graph: Graph;
	bundle: ReactiveFlowLayoutBundle;
	setContainerSize: (w: number, h: number) => void;
	sourceCode: string;
	registry: NodeRegistry;
	essay: string;
	initialObstacles: Obstacle[];
};

const ESSAY =
	"Text on the web has lived in rigid boxes for thirty years. The browser owns measurement, and every time you ask how wide a paragraph will render, the engine stops to recompute the layout of every other element on the page. CSS Shapes promised magazine-style wrap around photographs and drop caps, but the specification only works with floats, only wraps on one side, and gives you no access to the resulting line geometry. You cannot know where the lines begin. You cannot know where they end. You can only hope the browser arrives at the shape you imagined. " +
	"This demo wraps text around obstacles whose positions change every animation frame. Each line's available width is computed from the intersection of its vertical band with every obstacle — circles, rectangles, anything you can turn into a horizontal interval. A cursor walks the prepared segments, filling one slot at a time. When a line ends at a column boundary, the cursor picks up in the next column exactly where it left off. No duplicated text. No gap. Five milliseconds per frame for a layout the browser's own engine was never designed to produce. " +
	"The library exposes three primitives: layoutNextLine, which lays out a single line starting from a cursor and stopping at a supplied slot width; carveTextLineSlots, which subtracts blocked intervals from a base interval and hands back the remaining slots in left-to-right order; and reactiveFlowLayout, which wires the two together inside a GraphReFly graph. Obstacles are a state node. Text is a state node. Segments are a derived node that recomputes only when text or font changes. Flow lines are a derived node that recomputes whenever anything beneath it changes — which, for an animated obstacle, means every frame. The graph is the whole editorial engine.";

export function buildFlowChapter(): FlowChapter {
	const adapter = getMeasurementAdapter();

	const initialObstacles: Obstacle[] = [
		{ kind: "circle", cx: 170, cy: 140, r: 52, hPad: 18, vPad: 6 },
		{ kind: "circle", cx: 440, cy: 300, r: 44, hPad: 18, vPad: 6 },
		{ kind: "rect", x: 260, y: 430, w: 120, h: 62, hPad: 18, vPad: 6 },
	];

	const bundle = reactiveFlowLayout({
		adapter,
		name: "layout.flow",
		text: ESSAY,
		font: LAYOUT_FONT,
		lineHeight: LAYOUT_LINE_HEIGHT,
		container: FLOW_CONTAINER,
		columns: { count: 2, gap: 28 },
		obstacles: initialObstacles,
		minSlotWidth: 32,
	});

	// Registry maps each reactive-node name to (source-line, DOM selector) so
	// the demo-shell can cross-highlight node ↔ code ↔ visual. Line numbers
	// are 1-based against FLOW_SOURCE above.
	const registry: NodeRegistry = new Map([
		["text", { codeLine: 4, visualSelector: "[data-flow='lines']" }],
		["font", { codeLine: 5, visualSelector: "[data-flow='lines']" }],
		["line-height", { codeLine: 6, visualSelector: "[data-flow='lines']" }],
		["container", { codeLine: 7, visualSelector: "[data-flow='container']" }],
		["columns", { codeLine: 8, visualSelector: "[data-flow='container']" }],
		["obstacles", { codeLine: 9, visualSelector: "[data-flow='obstacles']" }],
		// `segments` derives from text + font — the line that mentions it.
		["segments", { codeLine: 28, visualSelector: "[data-flow='lines']" }],
		// `flow-lines` re-runs every rAF tick — same line mentions it.
		["flow-lines", { codeLine: 28, visualSelector: "[data-flow='lines']" }],
	]);

	return {
		graph: bundle.graph,
		bundle,
		setContainerSize: (w: number, h: number) =>
			bundle.setContainer({ ...FLOW_CONTAINER, width: w, height: h }),
		sourceCode: FLOW_SOURCE,
		registry,
		essay: ESSAY,
		initialObstacles,
	};
}

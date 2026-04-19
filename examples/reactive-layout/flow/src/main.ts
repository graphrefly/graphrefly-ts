import { DATA, ERROR, effect } from "@graphrefly/graphrefly/core";
import { fromRaf } from "@graphrefly/graphrefly/extra/sources";
import {
	CanvasMeasureAdapter,
	type Obstacle,
	type PositionedLine,
	reactiveFlowLayout,
} from "@graphrefly/graphrefly/patterns/reactive-layout";

// ---------------------------------------------------------------------------
// Stage setup — a simple HTML <main> with a fixed-size stage. The layout
// graph computes where each line goes; we reflect its output into DOM nodes.
// ---------------------------------------------------------------------------

const stage = document.getElementById("stage") as HTMLDivElement;

const CONTAINER = { width: 640, height: 540, paddingX: 20, paddingY: 16 };
const LINE_HEIGHT = 22;
const FONT = "14px ui-monospace, Menlo, monospace";

stage.style.position = "relative";
stage.style.width = `${CONTAINER.width}px`;
stage.style.height = `${CONTAINER.height}px`;
stage.style.background = "#11151b";
stage.style.border = "1px solid #2a2f36";
stage.style.borderRadius = "8px";
stage.style.margin = "2rem auto";
stage.style.overflow = "hidden";
stage.style.color = "#e6e6e6";
stage.style.fontFamily = FONT;

const ESSAY =
	"Text on the web has lived in rigid boxes for thirty years. The browser owns measurement, " +
	"and every time you ask how wide a paragraph will render, the engine stops to recompute the " +
	"layout of every other element on the page. CSS Shapes promised magazine-style wrap around " +
	"photographs and drop caps, but the specification only works with floats, only wraps on one " +
	"side, and gives you no access to the resulting line geometry. " +
	"This demo wraps text around obstacles whose positions change every animation frame. Each " +
	"line's available width is computed from the intersection of its vertical band with every " +
	"obstacle. A cursor walks the prepared segments, filling one slot at a time. When a line ends " +
	"at a column boundary, the cursor picks up in the next column exactly where it left off. No " +
	"duplicated text. No gap. The library exposes three primitives: layoutNextLine, " +
	"carveTextLineSlots, and reactiveFlowLayout — which wires them into a GraphReFly graph.";

// ---------------------------------------------------------------------------
// Initial obstacles + drift parameters. Each obstacle carries its own phase
// offset and velocity — the animation step reads them and computes a bounce
// within the container bounds. `seed` stays constant so the motion is stable.
// ---------------------------------------------------------------------------

type BouncingCircle = {
	kind: "circle";
	baseX: number;
	baseY: number;
	ampX: number;
	ampY: number;
	speedX: number;
	speedY: number;
	r: number;
};

const seed: BouncingCircle[] = [
	{
		kind: "circle",
		baseX: 170,
		baseY: 140,
		ampX: 90,
		ampY: 50,
		speedX: 0.0011,
		speedY: 0.0017,
		r: 52,
	},
	{
		kind: "circle",
		baseX: 460,
		baseY: 300,
		ampX: 110,
		ampY: 80,
		speedX: 0.0009,
		speedY: 0.0013,
		r: 44,
	},
	{
		kind: "circle",
		baseX: 320,
		baseY: 440,
		ampX: 140,
		ampY: 40,
		speedX: 0.0007,
		speedY: 0.0019,
		r: 38,
	},
];

function driftAt(t: number): Obstacle[] {
	return seed.map((o) => ({
		kind: "circle",
		cx: o.baseX + o.ampX * Math.sin(t * o.speedX),
		cy: o.baseY + o.ampY * Math.sin(t * o.speedY),
		r: o.r,
		hPad: 8,
		vPad: 4,
	}));
}

// ---------------------------------------------------------------------------
// Reactive graph — `reactiveFlowLayout` returns a bundle with state nodes
// (text / font / container / columns / obstacles) and two derived nodes
// (`segments`, `flowLines`). We only reach in to update `obstacles`; the
// rest of the graph propagates automatically.
// ---------------------------------------------------------------------------

const bundle = reactiveFlowLayout({
	adapter: new CanvasMeasureAdapter(),
	text: ESSAY,
	font: FONT,
	lineHeight: LINE_HEIGHT,
	container: CONTAINER,
	columns: { count: 2, gap: 28 },
	obstacles: driftAt(0),
	minSlotWidth: 32,
});

// ---------------------------------------------------------------------------
// DOM rendering — two reactive effects wired to the graph. One renders the
// obstacles (reads the `obstacles` state node). The other renders the wrapped
// lines (reads `flowLines`). Neither polls; both fire on dep change only.
// ---------------------------------------------------------------------------

const obstacleLayer = document.createElement("div");
obstacleLayer.dataset.flow = "obstacles";
stage.appendChild(obstacleLayer);

const linesLayer = document.createElement("div");
linesLayer.dataset.flow = "lines";
stage.appendChild(linesLayer);

const obstaclesNode = bundle.graph.node("obstacles");

effect([obstaclesNode], ([obstacles]) => {
	const arr = (obstacles as Obstacle[]) ?? [];
	obstacleLayer.innerHTML = "";
	for (const o of arr) {
		if (o.kind !== "circle") continue;
		const el = document.createElement("div");
		el.style.position = "absolute";
		el.style.left = `${o.cx - o.r}px`;
		el.style.top = `${o.cy - o.r}px`;
		el.style.width = `${o.r * 2}px`;
		el.style.height = `${o.r * 2}px`;
		el.style.borderRadius = "50%";
		el.style.background = "rgba(120, 170, 255, 0.15)";
		el.style.border = "1px solid rgba(120, 170, 255, 0.45)";
		el.style.pointerEvents = "none";
		obstacleLayer.appendChild(el);
	}
}).subscribe(() => {});

effect([bundle.flowLines], ([lines]) => {
	const arr = (lines as PositionedLine[]) ?? [];
	linesLayer.innerHTML = "";
	for (const line of arr) {
		const el = document.createElement("div");
		el.textContent = line.text;
		el.style.position = "absolute";
		el.style.left = `${line.x}px`;
		el.style.top = `${line.y}px`;
		el.style.width = `${line.slotWidth}px`;
		el.style.height = `${LINE_HEIGHT}px`;
		el.style.lineHeight = `${LINE_HEIGHT}px`;
		el.style.textAlign = line.flushToRight ? "right" : "justify";
		el.style.whiteSpace = "pre";
		el.style.overflow = "hidden";
		linesLayer.appendChild(el);
	}
}).subscribe(() => {});

// ---------------------------------------------------------------------------
// Reactive clock — `fromRaf()` is a GraphReFly source node emitting frame
// timestamps. We bridge each tick to `bundle.setObstacles(...)`, which writes
// the new positions through the graph. `flowLines` recomputes; `segments`
// stays cached (text + font unchanged).
//
// Composition note (guide §5): the `.subscribe(() => {})` keepalive on each
// effect activates the chain. `fromRaf` is its own reactive source — we read
// DATA from it and feed the graph. No setInterval, no raw requestAnimationFrame
// callback outside the graph.
// ---------------------------------------------------------------------------

const frame = fromRaf();
frame.subscribe((msgs) => {
	for (const [type, value] of msgs) {
		if (type === DATA) bundle.setObstacles(driftAt(value as number));
		else if (type === ERROR) console.error("fromRaf error:", value);
	}
});

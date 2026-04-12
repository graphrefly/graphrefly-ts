/**
 * Three-pane demo shell (roadmap §7.2).
 *
 * A `Graph("demo-shell")` that dogfoods reactive coordination for the
 * main/side split layout with synchronized cross-highlighting.
 *
 * **Zero framework dependency** — framework bindings wrap pane components only.
 * The shell graph is headless and fully testable.
 */

import { batch } from "../core/batch.js";
import { describeNode, resolveDescribeFields } from "../core/meta.js";
import { derived, effect, state } from "../core/sugar.js";
import { Graph } from "../graph/graph.js";
import type { MeasurementAdapter } from "./reactive-layout/reactive-layout.js";
import { analyzeAndMeasure, computeLineBreaks } from "./reactive-layout/reactive-layout.js";

// ——————————————————————————————————————————————————————————
//  Types
// ——————————————————————————————————————————————————————————

/** Identifies which pane is the source of a hover event. */
export type HoverPaneType = "visual" | "graph" | "code";

/** Cross-highlighting hover target. `null` means nothing hovered. */
export type HoverTarget = { pane: HoverPaneType; id: string } | null;

/** Which pane is full-screened (null = normal layout). */
export type FullscreenPane = "main" | "graph" | "code" | null;

/**
 * Cross-referencing registry: maps node paths to code line numbers and
 * visual element selectors. Provided by each demo's `store.ts`.
 */
export type NodeRegistry = Map<string, { codeLine: number; visualSelector: string }>;

/** Callbacks for cross-highlighting effect nodes. */
export type HighlightCallbacks = {
	/** Called when code-scroll highlight target changes. */
	codeScroll?: (line: number | null) => void;
	/** Called when visual highlight target changes. */
	visual?: (selector: string | null) => void;
	/** Called when graph highlight target changes. */
	graph?: (nodeId: string | null) => void;
};

/** Label dimensions for graph node sizing. */
export type GraphLabelSize = { width: number; height: number };

/** Options for {@link demoShell}. */
export type DemoShellOptions = {
	/** Initial main/side split ratio (0–1). Default: `0.65`. */
	mainRatio?: number;
	/** Initial graph/code vertical split in the side pane (0–1). Default: `0.5`. */
	sideSplit?: number;
	/** Initial viewport width in pixels. Default: `1280`. */
	viewportWidth?: number;
	/** Cross-referencing registry for hover→code/visual/graph mapping. */
	nodeRegistry?: NodeRegistry;
	/** Measurement adapter for layout engine integration. When provided, enables layout/* derived nodes. */
	adapter?: MeasurementAdapter;
	/** Font string for layout measurement. Default: `"14px monospace"`. */
	layoutFont?: string;
	/** Callbacks for cross-highlighting effect nodes. When provided, creates effect nodes visible in describe(). */
	onHighlight?: HighlightCallbacks;
};

/** Return type of {@link demoShell}. */
export type DemoShellHandle = {
	/** The demo-shell graph. */
	graph: Graph;

	// ── Convenience setters (shorthand for graph.set) ──────────
	setMainRatio(ratio: number): void;
	setSideSplit(ratio: number): void;
	setFullscreen(pane: FullscreenPane): void;
	setViewportWidth(width: number): void;
	setHoverTarget(target: HoverTarget): void;
	setDemoGraph(g: Graph | null): void;
	bumpGraphTick(): void;
	selectNode(path: string | null): void;
	setMetaDebug(on: boolean): void;
	/** Set code text for layout/code-lines measurement (requires adapter). */
	setCodeText(text: string): void;
	/** Atomic multi-set — wraps core `batch()` for glitch-free updates. */
	batch(fn: () => void): void;
	destroy(): void;
};

// ——————————————————————————————————————————————————————————
//  Helpers
// ——————————————————————————————————————————————————————————

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

// ——————————————————————————————————————————————————————————
//  Factory
// ——————————————————————————————————————————————————————————

/**
 * Creates the three-pane demo shell graph (roadmap §7.2).
 *
 * All coordination is reactive — no polling, no imperative triggers.
 * Framework bindings subscribe to named nodes and drive `state` inputs.
 */
export function demoShell(opts?: DemoShellOptions): DemoShellHandle {
	const mainRatioInit = clamp01(opts?.mainRatio ?? 0.65);
	const sideSplitInit = clamp01(opts?.sideSplit ?? 0.5);
	const viewportInit = Math.max(0, opts?.viewportWidth ?? 1280);
	const registry = opts?.nodeRegistry ?? new Map();
	const adapter = opts?.adapter ?? null;
	const layoutFont = opts?.layoutFont ?? "14px monospace";
	const onHighlight = opts?.onHighlight;

	const g = new Graph("demo-shell");

	// ── Layout state ─────────────────────────────────────
	const paneMainRatio = state(mainRatioInit, { name: "pane/main-ratio" });
	const paneSideSplit = state(sideSplitInit, { name: "pane/side-split" });
	const paneFullscreen = state<FullscreenPane>(null, {
		name: "pane/fullscreen",
	});
	const viewportWidth = state(viewportInit, { name: "viewport/width" });

	g.add("pane/main-ratio", paneMainRatio);
	g.add("pane/side-split", paneSideSplit);
	g.add("pane/fullscreen", paneFullscreen);
	g.add("viewport/width", viewportWidth);

	// ── Derived pane dimensions ──────────────────────────
	const paneMainWidth = derived(
		[paneMainRatio, viewportWidth, paneFullscreen],
		([ratio, vw, fs]) => {
			const r = ratio as number;
			const w = vw as number;
			const fullscreen = fs as FullscreenPane;
			if (fullscreen === "main") return w;
			if (fullscreen === "graph" || fullscreen === "code") return 0;
			return Math.round(w * r);
		},
		{ name: "pane/main-width" },
	);

	const paneSideWidth = derived(
		[paneMainWidth, viewportWidth, paneFullscreen],
		([main, vw, fs]) => {
			const fullscreen = fs as FullscreenPane;
			const w = vw as number;
			if (fullscreen === "main") return 0;
			if (fullscreen === "graph" || fullscreen === "code") return w;
			return (w as number) - (main as number);
		},
		{ name: "pane/side-width" },
	);

	const paneGraphHeight = derived(
		[paneSideSplit, paneFullscreen],
		([split, fs]) => {
			const fullscreen = fs as FullscreenPane;
			if (fullscreen === "graph") return 1;
			if (fullscreen === "code") return 0;
			if (fullscreen === "main") return 0;
			return clamp01(split as number);
		},
		{ name: "pane/graph-height-ratio" },
	);

	const paneCodeHeight = derived(
		[paneGraphHeight, paneFullscreen],
		([graphH, fs]) => {
			const fullscreen = fs as FullscreenPane;
			if (fullscreen === "code") return 1;
			if (fullscreen === "graph" || fullscreen === "main") return 0;
			return 1 - (graphH as number);
		},
		{ name: "pane/code-height-ratio" },
	);

	g.add("pane/main-width", paneMainWidth);
	g.add("pane/side-width", paneSideWidth);
	g.add("pane/graph-height-ratio", paneGraphHeight);
	g.add("pane/code-height-ratio", paneCodeHeight);

	// ── External graph observation ───────────────────────
	const demoGraphRef = state<Graph | null>(null, {
		name: "demo/graph-ref",
	});
	const demoGraphTick = state(0, { name: "demo/graph-tick" });

	g.add("demo/graph-ref", demoGraphRef);
	g.add("demo/graph-tick", demoGraphTick);

	const graphMermaid = derived(
		[demoGraphRef, demoGraphTick],
		([ref, _tick]) => {
			const demo = ref as Graph | null;
			if (!demo) return "";
			return demo.toMermaid();
		},
		{ name: "graph/mermaid" },
	);

	const graphDescribe = derived(
		[demoGraphRef, demoGraphTick],
		([ref, _tick]) => {
			const demo = ref as Graph | null;
			if (!demo) return null;
			const { expand: _, ...snapshot } = demo.describe({ detail: "standard" });
			return snapshot;
		},
		{ name: "graph/describe" },
	);

	g.add("graph/mermaid", graphMermaid);
	g.add("graph/describe", graphDescribe);

	// ── Cross-highlighting ───────────────────────────────
	const hoverTarget = state<HoverTarget>(null, { name: "hover/target" });
	g.add("hover/target", hoverTarget);

	const highlightCodeScroll = derived(
		[hoverTarget],
		([target]) => {
			const t = target as HoverTarget;
			if (!t) return null;
			const entry = registry.get(t.id);
			return entry ? entry.codeLine : null;
		},
		{ name: "highlight/code-scroll" },
	);

	const highlightVisual = derived(
		[hoverTarget],
		([target]) => {
			const t = target as HoverTarget;
			if (!t) return null;
			const entry = registry.get(t.id);
			return entry ? entry.visualSelector : null;
		},
		{ name: "highlight/visual" },
	);

	const highlightGraph = derived(
		[hoverTarget],
		([target]) => {
			const t = target as HoverTarget;
			if (!t) return null;
			return t.id;
		},
		{ name: "highlight/graph" },
	);

	g.add("highlight/code-scroll", highlightCodeScroll);
	g.add("highlight/visual", highlightVisual);
	g.add("highlight/graph", highlightGraph);

	// ── Cross-highlighting effect nodes (optional) ─────
	// Created when onHighlight callbacks are provided, making the full
	// source→derived→effect chain visible in describe()/toMermaid().

	if (onHighlight?.codeScroll) {
		const cb = onHighlight.codeScroll;
		const applyCodeScroll = effect([highlightCodeScroll], ([line]) => {
			cb(line as number | null);
		});
		g.add("highlight/apply-code-scroll", applyCodeScroll);
		g.connect("highlight/code-scroll", "highlight/apply-code-scroll");
	}

	if (onHighlight?.visual) {
		const cb = onHighlight.visual;
		const applyVisual = effect([highlightVisual], ([selector]) => {
			cb(selector as string | null);
		});
		g.add("highlight/apply-visual", applyVisual);
		g.connect("highlight/visual", "highlight/apply-visual");
	}

	if (onHighlight?.graph) {
		const cb = onHighlight.graph;
		const applyGraph = effect([highlightGraph], ([nodeId]) => {
			cb(nodeId as string | null);
		});
		g.add("highlight/apply-graph", applyGraph);
		g.connect("highlight/graph", "highlight/apply-graph");
	}

	// ── Inspect panel ────────────────────────────────────
	const inspectSelected = state<string | null>(null, {
		name: "inspect/selected-node",
	});
	g.add("inspect/selected-node", inspectSelected);

	const standardFields = resolveDescribeFields("standard");

	const inspectNodeDetail = derived(
		[inspectSelected, demoGraphRef, demoGraphTick],
		([path, ref, _tick]) => {
			const demo = ref as Graph | null;
			const p = path as string | null;
			if (!demo || !p) return null;
			try {
				const nd = demo.resolve(p);
				const nodeDesc = describeNode(nd, standardFields);
				return { path: p, ...nodeDesc, value: nd.cache };
			} catch {
				return null;
			}
		},
		{ name: "inspect/node-detail" },
	);

	const inspectTraceLog = derived(
		[demoGraphRef, demoGraphTick],
		([ref, _tick]) => {
			const demo = ref as Graph | null;
			if (!demo) return [];
			return demo.trace();
		},
		{ name: "inspect/trace-log" },
	);

	g.add("inspect/node-detail", inspectNodeDetail);
	g.add("inspect/trace-log", inspectTraceLog);

	// ── Meta debug toggle ────────────────────────────────
	const metaDebug = state(false, { name: "meta/debug" });
	g.add("meta/debug", metaDebug);

	const metaShellMermaid = derived(
		[metaDebug, demoGraphTick],
		([debug, _tick]) => {
			if (!(debug as boolean)) return "";
			return g.toMermaid();
		},
		{ name: "meta/shell-mermaid" },
	);
	g.add("meta/shell-mermaid", metaShellMermaid);

	// ── Layout engine integration (optional, requires adapter) ──
	const codeTextNode = state("", { name: "layout/code-text" });
	g.add("layout/code-text", codeTextNode);

	if (adapter) {
		const measureCache = new Map<string, Map<string, number>>();

		const graphLabels = derived(
			[graphDescribe],
			([desc]) => {
				const d = desc as { nodes: Record<string, { type: string }> } | null;
				if (!d) return new Map<string, GraphLabelSize>();
				const result = new Map<string, GraphLabelSize>();
				for (const [name] of Object.entries(d.nodes)) {
					const segments = analyzeAndMeasure(name, layoutFont, adapter, measureCache);
					const lb = computeLineBreaks(segments, Infinity, adapter, layoutFont, measureCache);
					const width = lb.lines.reduce((max, l) => Math.max(max, l.width), 0);
					const height = lb.lineCount * 20; // line-height approximation
					result.set(name, { width, height });
				}
				return result;
			},
			{
				name: "layout/graph-labels",
				equals: (a, b) => {
					if (a === b) return true;
					const ma = a as Map<string, GraphLabelSize>;
					const mb = b as Map<string, GraphLabelSize>;
					if (ma.size !== mb.size) return false;
					for (const [k, v] of ma) {
						const bv = mb.get(k);
						if (!bv || bv.width !== v.width || bv.height !== v.height) return false;
					}
					return true;
				},
			},
		);

		const codeLines = derived(
			[codeTextNode, paneSideWidth],
			([text, sideW]) => {
				const t = text as string;
				if (!t) return { lineCount: 0, lines: [] };
				const segments = analyzeAndMeasure(t, layoutFont, adapter, measureCache);
				const maxW = (sideW as number) - 40; // side pane minus padding
				return computeLineBreaks(segments, Math.max(100, maxW), adapter, layoutFont, measureCache);
			},
			{ name: "layout/code-lines" },
		);

		const sideWidthHint = derived(
			[graphLabels],
			([labels]) => {
				const m = labels as Map<string, GraphLabelSize>;
				if (m.size === 0) return 200; // minimum default
				let maxW = 0;
				for (const { width } of m.values()) {
					if (width > maxW) maxW = width;
				}
				// widest label + padding (node box chrome + margin)
				return Math.max(200, Math.round(maxW + 80));
			},
			{ name: "layout/side-width-hint" },
		);

		g.add("layout/graph-labels", graphLabels);
		g.add("layout/code-lines", codeLines);
		g.add("layout/side-width-hint", sideWidthHint);

		g.connect("graph/describe", "layout/graph-labels");
		g.connect("layout/code-text", "layout/code-lines");
		g.connect("pane/side-width", "layout/code-lines");
		g.connect("layout/graph-labels", "layout/side-width-hint");
	}

	// ── Edges (explicit wiring for describe/toMermaid) ───
	g.connect("pane/main-ratio", "pane/main-width");
	g.connect("viewport/width", "pane/main-width");
	g.connect("pane/fullscreen", "pane/main-width");
	g.connect("pane/main-width", "pane/side-width");
	g.connect("viewport/width", "pane/side-width");
	g.connect("pane/fullscreen", "pane/side-width");
	g.connect("pane/side-split", "pane/graph-height-ratio");
	g.connect("pane/fullscreen", "pane/graph-height-ratio");
	g.connect("pane/graph-height-ratio", "pane/code-height-ratio");
	g.connect("pane/fullscreen", "pane/code-height-ratio");
	g.connect("demo/graph-ref", "graph/mermaid");
	g.connect("demo/graph-tick", "graph/mermaid");
	g.connect("demo/graph-ref", "graph/describe");
	g.connect("demo/graph-tick", "graph/describe");
	g.connect("hover/target", "highlight/code-scroll");
	g.connect("hover/target", "highlight/visual");
	g.connect("hover/target", "highlight/graph");
	g.connect("inspect/selected-node", "inspect/node-detail");
	g.connect("demo/graph-ref", "inspect/node-detail");
	g.connect("demo/graph-tick", "inspect/node-detail");
	g.connect("demo/graph-ref", "inspect/trace-log");
	g.connect("demo/graph-tick", "inspect/trace-log");
	g.connect("meta/debug", "meta/shell-mermaid");
	g.connect("demo/graph-tick", "meta/shell-mermaid");

	// ── Handle ───────────────────────────────────────────
	let tickCounter = 0;
	return {
		graph: g,
		setMainRatio(ratio: number) {
			g.set("pane/main-ratio", clamp01(ratio));
		},
		setSideSplit(ratio: number) {
			g.set("pane/side-split", clamp01(ratio));
		},
		setFullscreen(pane: FullscreenPane) {
			g.set("pane/fullscreen", pane);
		},
		setViewportWidth(width: number) {
			g.set("viewport/width", Math.max(0, width));
		},
		setHoverTarget(target: HoverTarget) {
			g.set("hover/target", target);
		},
		setDemoGraph(demo: Graph | null) {
			g.set("demo/graph-ref", demo);
		},
		bumpGraphTick() {
			g.set("demo/graph-tick", ++tickCounter);
		},
		selectNode(path: string | null) {
			g.set("inspect/selected-node", path);
		},
		setMetaDebug(on: boolean) {
			g.set("meta/debug", on);
		},
		setCodeText(text: string) {
			g.set("layout/code-text", text);
		},
		batch(fn: () => void) {
			batch(fn);
		},
		destroy() {
			g.destroy();
		},
	};
}

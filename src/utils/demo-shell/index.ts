/**
 * Three-pane demo shell (roadmap §7.2).
 *
 * A `Graph("demo-shell")` that dogfoods reactive coordination for the
 * main/side split layout with synchronized cross-highlighting.
 *
 * **Zero framework dependency** — framework bindings wrap pane components only.
 * The shell graph is headless and fully testable.
 */

import { batch, node } from "@graphrefly/pure-ts/core";
import { Graph } from "@graphrefly/pure-ts/graph";
import { graphSpecToMermaid } from "../../base/render/index.js";
import type { MeasurementAdapter } from "../reactive-layout/reactive-layout.js";
import { analyzeAndMeasure, computeLineBreaks } from "../reactive-layout/reactive-layout.js";

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
	const paneMainRatio = node([], { ...{ name: "pane/main-ratio" }, initial: mainRatioInit });
	const paneSideSplit = node([], { ...{ name: "pane/side-split" }, initial: sideSplitInit });
	const paneFullscreen = node<FullscreenPane>([], {
		...{
			name: "pane/fullscreen",
		},
		initial: null,
	});
	const viewportWidth = node([], { ...{ name: "viewport/width" }, initial: viewportInit });

	g.add(paneMainRatio, { name: "pane/main-ratio" });
	g.add(paneSideSplit, { name: "pane/side-split" });
	g.add(paneFullscreen, { name: "pane/fullscreen" });
	g.add(viewportWidth, { name: "viewport/width" });

	// ── Derived pane dimensions ──────────────────────────
	const paneMainWidth = node(
		[paneMainRatio, viewportWidth, paneFullscreen],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const r = data[0] as number;
			const w = data[1] as number;
			const fullscreen = data[2] as FullscreenPane;
			if (fullscreen === "main") actions.emit(w);
			else if (fullscreen === "graph" || fullscreen === "code") actions.emit(0);
			else actions.emit(Math.round(w * r));
		},
		{ describeKind: "derived", ...{ name: "pane/main-width" } },
	);

	const paneSideWidth = node(
		[paneMainWidth, viewportWidth, paneFullscreen],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const main = data[0] as number;
			const w = data[1] as number;
			const fullscreen = data[2] as FullscreenPane;
			if (fullscreen === "main") actions.emit(0);
			else if (fullscreen === "graph" || fullscreen === "code") actions.emit(w);
			else actions.emit(w - main);
		},
		{ describeKind: "derived", ...{ name: "pane/side-width" } },
	);

	const paneGraphHeight = node(
		[paneSideSplit, paneFullscreen],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const split = data[0] as number;
			const fullscreen = data[1] as FullscreenPane;
			if (fullscreen === "graph") actions.emit(1);
			else if (fullscreen === "code") actions.emit(0);
			else if (fullscreen === "main") actions.emit(0);
			else actions.emit(clamp01(split));
		},
		{ describeKind: "derived", ...{ name: "pane/graph-height-ratio" } },
	);

	const paneCodeHeight = node(
		[paneGraphHeight, paneFullscreen],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const graphH = data[0] as number;
			const fullscreen = data[1] as FullscreenPane;
			if (fullscreen === "code") actions.emit(1);
			else if (fullscreen === "graph" || fullscreen === "main") actions.emit(0);
			else actions.emit(1 - graphH);
		},
		{ describeKind: "derived", ...{ name: "pane/code-height-ratio" } },
	);

	g.add(paneMainWidth, { name: "pane/main-width" });
	g.add(paneSideWidth, { name: "pane/side-width" });
	g.add(paneGraphHeight, { name: "pane/graph-height-ratio" });
	g.add(paneCodeHeight, { name: "pane/code-height-ratio" });

	// ── External graph observation ───────────────────────
	const demoGraphRef = node<Graph | null>([], {
		...{
			name: "demo/graph-ref",
		},
		initial: null,
	});
	const demoGraphTick = node([], { ...{ name: "demo/graph-tick" }, initial: 0 });

	g.add(demoGraphRef, { name: "demo/graph-ref" });
	g.add(demoGraphTick, { name: "demo/graph-tick" });

	const graphMermaid = node(
		[demoGraphRef, demoGraphTick],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const demo = data[0] as Graph | null;
			actions.emit(demo ? graphSpecToMermaid(demo.describe()) : "");
		},
		{ describeKind: "derived", ...{ name: "graph/mermaid" } },
	);

	const graphDescribe = node(
		[demoGraphRef, demoGraphTick],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const demo = data[0] as Graph | null;
			if (!demo) {
				actions.emit(null);
				return;
			}
			const { expand: _, ...snapshot } = demo.describe({ detail: "standard" });
			actions.emit(snapshot);
		},
		{ describeKind: "derived", ...{ name: "graph/describe" } },
	);

	g.add(graphMermaid, { name: "graph/mermaid" });
	g.add(graphDescribe, { name: "graph/describe" });

	// ── Cross-highlighting ───────────────────────────────
	const hoverTarget = node<HoverTarget>([], { ...{ name: "hover/target" }, initial: null });
	g.add(hoverTarget, { name: "hover/target" });

	const highlightCodeScroll = node(
		[hoverTarget],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const t = data[0] as HoverTarget;
			if (!t) {
				actions.emit(null);
				return;
			}
			const entry = registry.get(t.id);
			actions.emit(entry ? entry.codeLine : null);
		},
		{ describeKind: "derived", ...{ name: "highlight/code-scroll" } },
	);

	const highlightVisual = node(
		[hoverTarget],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const t = data[0] as HoverTarget;
			if (!t) {
				actions.emit(null);
				return;
			}
			const entry = registry.get(t.id);
			actions.emit(entry ? entry.visualSelector : null);
		},
		{ describeKind: "derived", ...{ name: "highlight/visual" } },
	);

	const highlightGraph = node(
		[hoverTarget],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const t = data[0] as HoverTarget;
			actions.emit(t ? t.id : null);
		},
		{ describeKind: "derived", ...{ name: "highlight/graph" } },
	);

	g.add(highlightCodeScroll, { name: "highlight/code-scroll" });
	g.add(highlightVisual, { name: "highlight/visual" });
	g.add(highlightGraph, { name: "highlight/graph" });

	// ── Cross-highlighting effect nodes (optional) ─────
	// Created when onHighlight callbacks are provided, making the full
	// source→derived→effect chain visible in describe()/graphSpecToMermaid().

	if (onHighlight?.codeScroll) {
		const cb = onHighlight.codeScroll;
		const applyCodeScroll = node(
			[highlightCodeScroll],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				cb(data[0] as number | null);
			},
			{ describeKind: "effect" },
		);
		g.add(applyCodeScroll, { name: "highlight/apply-code-scroll" });
	}

	if (onHighlight?.visual) {
		const cb = onHighlight.visual;
		const applyVisual = node(
			[highlightVisual],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				cb(data[0] as string | null);
			},
			{ describeKind: "effect" },
		);
		g.add(applyVisual, { name: "highlight/apply-visual" });
	}

	if (onHighlight?.graph) {
		const cb = onHighlight.graph;
		const applyGraph = node(
			[highlightGraph],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				cb(data[0] as string | null);
			},
			{ describeKind: "effect" },
		);
		g.add(applyGraph, { name: "highlight/apply-graph" });
	}

	// ── Inspect panel ────────────────────────────────────
	const inspectSelected = node<string | null>([], {
		...{
			name: "inspect/selected-node",
		},
		initial: null,
	});
	g.add(inspectSelected, { name: "inspect/selected-node" });

	const inspectNodeDetail = node(
		[inspectSelected, demoGraphRef, demoGraphTick],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const p = data[0] as string | null;
			const demo = data[1] as Graph | null;
			if (!demo || !p) {
				actions.emit(null);
				return;
			}
			try {
				const snap = demo.describe({ detail: "standard" });
				const nodeDesc = snap.nodes[p];
				if (!nodeDesc) {
					actions.emit(null);
					return;
				}
				actions.emit({ path: p, ...nodeDesc });
			} catch {
				actions.emit(null);
			}
		},
		{ describeKind: "derived", ...{ name: "inspect/node-detail" } },
	);

	const inspectTraceLog = node(
		[demoGraphRef, demoGraphTick],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const demo = data[0] as Graph | null;
			actions.emit(demo ? demo.trace() : []);
		},
		{ describeKind: "derived", ...{ name: "inspect/trace-log" } },
	);

	g.add(inspectNodeDetail, { name: "inspect/node-detail" });
	g.add(inspectTraceLog, { name: "inspect/trace-log" });

	// ── Meta debug toggle ────────────────────────────────
	const metaDebug = node([], { ...{ name: "meta/debug" }, initial: false });
	g.add(metaDebug, { name: "meta/debug" });

	const metaShellMermaid = node(
		[metaDebug, demoGraphTick],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data[0] as boolean) ? graphSpecToMermaid(g.describe()) : "");
		},
		{ describeKind: "derived", ...{ name: "meta/shell-mermaid" } },
	);
	g.add(metaShellMermaid, { name: "meta/shell-mermaid" });

	// ── Layout engine integration (optional, requires adapter) ──
	const codeTextNode = node([], { ...{ name: "layout/code-text" }, initial: "" });
	g.add(codeTextNode, { name: "layout/code-text" });

	if (adapter) {
		const measureCache = new Map<string, Map<string, number>>();

		const graphLabels = node(
			[graphDescribe],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const d = data[0] as { nodes: Record<string, { type: string }> } | null;
				if (!d) {
					actions.emit(new Map<string, GraphLabelSize>());
					return;
				}
				const result = new Map<string, GraphLabelSize>();
				for (const [name] of Object.entries(d.nodes)) {
					const segments = analyzeAndMeasure(name, layoutFont, adapter, measureCache);
					const lb = computeLineBreaks(segments, Infinity, adapter, layoutFont, measureCache);
					const width = lb.lines.reduce((max, l) => Math.max(max, l.width), 0);
					const height = lb.lineCount * 20; // line-height approximation
					result.set(name, { width, height });
				}
				actions.emit(result);
			},
			{
				describeKind: "derived",
				...{
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
			},
		);

		const codeLines = node(
			[codeTextNode, paneSideWidth],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const t = data[0] as string;
				if (!t) {
					actions.emit({ lineCount: 0, lines: [] });
					return;
				}
				const segments = analyzeAndMeasure(t, layoutFont, adapter, measureCache);
				const maxW = (data[1] as number) - 40; // side pane minus padding
				actions.emit(
					computeLineBreaks(segments, Math.max(100, maxW), adapter, layoutFont, measureCache),
				);
			},
			{ describeKind: "derived", name: "layout/code-lines" },
		);

		const sideWidthHint = node(
			[graphLabels],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const m = data[0] as Map<string, GraphLabelSize>;
				if (m.size === 0) {
					actions.emit(200);
					return;
				}
				let maxW = 0;
				for (const { width } of m.values()) {
					if (width > maxW) maxW = width;
				}
				// widest label + padding (node box chrome + margin)
				actions.emit(Math.max(200, Math.round(maxW + 80)));
			},
			{ describeKind: "derived", name: "layout/side-width-hint" },
		);

		g.add(graphLabels, { name: "layout/graph-labels" });
		g.add(codeLines, { name: "layout/code-lines" });
		g.add(sideWidthHint, { name: "layout/side-width-hint" });
	}

	// ── Edges (explicit wiring for describe/graphSpecToMermaid) ───

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

import { describe, expect, it, vi } from "vitest";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";
import {
	type DemoShellHandle,
	demoShell,
	type GraphLabelSize,
	type HighlightCallbacks,
	type HoverTarget,
	type NodeRegistry,
} from "../../patterns/demo-shell.js";
import { CliMeasureAdapter } from "../../patterns/reactive-layout/measurement-adapters.js";
import type { LineBreaksResult } from "../../patterns/reactive-layout/reactive-layout.js";

describe("patterns.demoShell", () => {
	// ── Factory & graph shape ────────────────────────────

	it("creates a Graph named 'demo-shell'", () => {
		const { graph } = demoShell();
		expect(graph).toBeInstanceOf(Graph);
		expect(graph.name).toBe("demo-shell");
	});

	it("describe() exposes all expected nodes", () => {
		const { graph } = demoShell();
		const desc = graph.describe();
		const paths = Object.keys(desc.nodes).sort();
		expect(paths).toContain("pane/main-ratio");
		expect(paths).toContain("pane/side-split");
		expect(paths).toContain("pane/fullscreen");
		expect(paths).toContain("viewport/width");
		expect(paths).toContain("pane/main-width");
		expect(paths).toContain("pane/side-width");
		expect(paths).toContain("pane/graph-height-ratio");
		expect(paths).toContain("pane/code-height-ratio");
		expect(paths).toContain("demo/graph-ref");
		expect(paths).toContain("demo/graph-tick");
		expect(paths).toContain("graph/mermaid");
		expect(paths).toContain("graph/describe");
		expect(paths).toContain("hover/target");
		expect(paths).toContain("highlight/code-scroll");
		expect(paths).toContain("highlight/visual");
		expect(paths).toContain("highlight/graph");
		expect(paths).toContain("inspect/selected-node");
		expect(paths).toContain("inspect/node-detail");
		expect(paths).toContain("inspect/trace-log");
		expect(paths).toContain("meta/debug");
		expect(paths).toContain("meta/shell-mermaid");
	});

	it("edges are registered in the graph", () => {
		const { graph } = demoShell();
		const edges = graph.edges();
		expect(edges).toContainEqual(["pane/main-ratio", "pane/main-width"]);
		expect(edges).toContainEqual(["viewport/width", "pane/main-width"]);
		expect(edges).toContainEqual(["demo/graph-ref", "graph/mermaid"]);
		expect(edges).toContainEqual(["hover/target", "highlight/graph"]);
		expect(edges).toContainEqual(["meta/debug", "meta/shell-mermaid"]);
	});

	// ── Layout derivation ────────────────────────────────

	it("derives pane widths from main-ratio and viewport", () => {
		const shell = demoShell({ mainRatio: 0.6, viewportWidth: 1000 });
		// Force subscription so derived nodes compute
		subscribePath(shell, "pane/main-width");
		subscribePath(shell, "pane/side-width");

		expect(shell.graph.get("pane/main-width")).toBe(600);
		expect(shell.graph.get("pane/side-width")).toBe(400);
	});

	it("setMainRatio clamps to [0,1] and updates widths", () => {
		const shell = demoShell({ viewportWidth: 1000 });
		subscribePath(shell, "pane/main-width");
		subscribePath(shell, "pane/side-width");

		shell.setMainRatio(0.8);
		expect(shell.graph.get("pane/main-width")).toBe(800);
		expect(shell.graph.get("pane/side-width")).toBe(200);

		shell.setMainRatio(1.5); // clamped to 1
		expect(shell.graph.get("pane/main-width")).toBe(1000);

		shell.setMainRatio(-0.1); // clamped to 0
		expect(shell.graph.get("pane/main-width")).toBe(0);
	});

	it("fullscreen=main gives main 100%, side 0%", () => {
		const shell = demoShell({ viewportWidth: 1000 });
		subscribePath(shell, "pane/main-width");
		subscribePath(shell, "pane/side-width");

		shell.setFullscreen("main");
		expect(shell.graph.get("pane/main-width")).toBe(1000);
		expect(shell.graph.get("pane/side-width")).toBe(0);
	});

	it("fullscreen=graph gives side 100%, main 0%", () => {
		const shell = demoShell({ viewportWidth: 1000 });
		subscribePath(shell, "pane/main-width");
		subscribePath(shell, "pane/side-width");
		subscribePath(shell, "pane/graph-height-ratio");
		subscribePath(shell, "pane/code-height-ratio");

		shell.setFullscreen("graph");
		expect(shell.graph.get("pane/main-width")).toBe(0);
		expect(shell.graph.get("pane/side-width")).toBe(1000);
		expect(shell.graph.get("pane/graph-height-ratio")).toBe(1);
		expect(shell.graph.get("pane/code-height-ratio")).toBe(0);
	});

	it("fullscreen=code gives code 100%", () => {
		const shell = demoShell({ viewportWidth: 1000 });
		subscribePath(shell, "pane/graph-height-ratio");
		subscribePath(shell, "pane/code-height-ratio");

		shell.setFullscreen("code");
		expect(shell.graph.get("pane/graph-height-ratio")).toBe(0);
		expect(shell.graph.get("pane/code-height-ratio")).toBe(1);
	});

	it("side-split controls graph/code ratio", () => {
		const shell = demoShell({ sideSplit: 0.7 });
		subscribePath(shell, "pane/graph-height-ratio");
		subscribePath(shell, "pane/code-height-ratio");

		expect(shell.graph.get("pane/graph-height-ratio")).toBe(0.7);
		expect(shell.graph.get("pane/code-height-ratio")).toBeCloseTo(0.3);
	});

	it("setViewportWidth updates pane widths reactively", () => {
		const shell = demoShell({ mainRatio: 0.5, viewportWidth: 800 });
		subscribePath(shell, "pane/main-width");

		expect(shell.graph.get("pane/main-width")).toBe(400);
		shell.setViewportWidth(1200);
		expect(shell.graph.get("pane/main-width")).toBe(600);
	});

	// ── External graph observation ───────────────────────

	it("graph/mermaid is empty when no demo graph is set", () => {
		const shell = demoShell();
		subscribePath(shell, "graph/mermaid");

		expect(shell.graph.get("graph/mermaid")).toBe("");
	});

	it("graph/mermaid derives from demo graph", () => {
		const shell = demoShell();
		subscribePath(shell, "graph/mermaid");

		const demo = new Graph("test-demo");
		const a = state(1, { name: "a" });
		demo.add("a", a);
		// derived node with a as constructor dep — connect requires real deps
		const b = derived([a], ([v]) => v, { name: "b" });
		demo.add("b", b);
		demo.connect("a", "b");

		shell.setDemoGraph(demo);
		const mermaid = shell.graph.get("graph/mermaid") as string;
		expect(mermaid).toContain("flowchart");
		expect(mermaid).toContain("a");
		expect(mermaid).toContain("b");
		expect(mermaid).toContain("-->");
	});

	it("bumpGraphTick re-derives mermaid after demo graph changes", () => {
		const shell = demoShell();
		subscribePath(shell, "graph/mermaid");

		const demo = new Graph("test-demo");
		demo.add("x", state(1, { name: "x" }));
		shell.setDemoGraph(demo);
		const before = shell.graph.get("graph/mermaid") as string;
		expect(before).toContain("x");

		demo.add("y", state(2, { name: "y" }));
		shell.bumpGraphTick();
		const after = shell.graph.get("graph/mermaid") as string;
		expect(after).toContain("y");
	});

	it("graph/describe returns null when no demo graph", () => {
		const shell = demoShell();
		subscribePath(shell, "graph/describe");

		expect(shell.graph.get("graph/describe")).toBeNull();
	});

	it("graph/describe returns snapshot of demo graph", () => {
		const shell = demoShell();
		subscribePath(shell, "graph/describe");

		const demo = new Graph("test-demo");
		demo.add("node1", state(42, { name: "node1" }));
		shell.setDemoGraph(demo);

		const desc = shell.graph.get("graph/describe") as Record<string, unknown>;
		expect(desc).not.toBeNull();
		expect((desc as { name: string }).name).toBe("test-demo");
	});

	// ── Cross-highlighting ───────────────────────────────

	it("hover target derives code-scroll from registry", () => {
		const registry: NodeRegistry = new Map([
			["myNode", { codeLine: 42, visualSelector: ".my-node" }],
		]);
		const shell = demoShell({ nodeRegistry: registry });
		subscribePath(shell, "highlight/code-scroll");
		subscribePath(shell, "highlight/visual");
		subscribePath(shell, "highlight/graph");

		shell.setHoverTarget({ pane: "graph", id: "myNode" });
		expect(shell.graph.get("highlight/code-scroll")).toBe(42);
		expect(shell.graph.get("highlight/visual")).toBe(".my-node");
		expect(shell.graph.get("highlight/graph")).toBe("myNode");
	});

	it("null hover target clears all highlights", () => {
		const registry: NodeRegistry = new Map([["myNode", { codeLine: 10, visualSelector: ".x" }]]);
		const shell = demoShell({ nodeRegistry: registry });
		subscribePath(shell, "highlight/code-scroll");
		subscribePath(shell, "highlight/visual");
		subscribePath(shell, "highlight/graph");

		shell.setHoverTarget({ pane: "visual", id: "myNode" });
		expect(shell.graph.get("highlight/code-scroll")).toBe(10);

		shell.setHoverTarget(null);
		expect(shell.graph.get("highlight/code-scroll")).toBeNull();
		expect(shell.graph.get("highlight/visual")).toBeNull();
		expect(shell.graph.get("highlight/graph")).toBeNull();
	});

	it("hover on unknown id returns null for code/visual", () => {
		const shell = demoShell({ nodeRegistry: new Map() });
		subscribePath(shell, "highlight/code-scroll");
		subscribePath(shell, "highlight/visual");
		subscribePath(shell, "highlight/graph");

		shell.setHoverTarget({ pane: "graph", id: "unknown" });
		expect(shell.graph.get("highlight/code-scroll")).toBeNull();
		expect(shell.graph.get("highlight/visual")).toBeNull();
		// graph highlight always returns the id
		expect(shell.graph.get("highlight/graph")).toBe("unknown");
	});

	// ── Inspect panel ────────────────────────────────────

	it("inspect/node-detail is null when no node selected", () => {
		const shell = demoShell();
		subscribePath(shell, "inspect/node-detail");

		expect(shell.graph.get("inspect/node-detail")).toBeNull();
	});

	it("inspect/node-detail returns node description when selected", () => {
		const shell = demoShell();
		subscribePath(shell, "inspect/node-detail");

		const demo = new Graph("test-demo");
		demo.add("counter", state(7, { name: "counter" }));
		shell.setDemoGraph(demo);
		shell.selectNode("counter");

		const detail = shell.graph.get("inspect/node-detail") as Record<string, unknown>;
		expect(detail).not.toBeNull();
		expect(detail.path).toBe("counter");
		expect(detail.value).toBe(7);
	});

	it("inspect/node-detail handles invalid path gracefully", () => {
		const shell = demoShell();
		subscribePath(shell, "inspect/node-detail");

		const demo = new Graph("test-demo");
		shell.setDemoGraph(demo);
		shell.selectNode("nonexistent");

		expect(shell.graph.get("inspect/node-detail")).toBeNull();
	});

	it("inspect/trace-log returns empty array when no demo graph", () => {
		const shell = demoShell();
		subscribePath(shell, "inspect/trace-log");

		expect(shell.graph.get("inspect/trace-log")).toEqual([]);
	});

	// ── Meta debug toggle ────────────────────────────────

	it("meta/shell-mermaid is empty when debug is off", () => {
		const shell = demoShell();
		subscribePath(shell, "meta/shell-mermaid");

		expect(shell.graph.get("meta/shell-mermaid")).toBe("");
	});

	it("meta/shell-mermaid renders the shell's own graph when debug is on", () => {
		const shell = demoShell();
		subscribePath(shell, "meta/shell-mermaid");

		shell.setMetaDebug(true);
		const mermaid = shell.graph.get("meta/shell-mermaid") as string;
		expect(mermaid).toContain("flowchart");
		// Should contain shell's own nodes
		expect(mermaid).toContain("pane/main-ratio");
		expect(mermaid).toContain("meta/shell-mermaid");
	});

	// ── Layout engine integration ────────────────────────

	it("layout nodes are absent without adapter", () => {
		const { graph } = demoShell();
		const desc = graph.describe();
		const paths = Object.keys(desc.nodes);
		// code-text state always exists; derived layout nodes require adapter
		expect(paths).toContain("layout/code-text");
		expect(paths).not.toContain("layout/graph-labels");
		expect(paths).not.toContain("layout/code-lines");
		expect(paths).not.toContain("layout/side-width-hint");
	});

	it("layout nodes are created when adapter is provided", () => {
		const adapter = new CliMeasureAdapter();
		const { graph } = demoShell({ adapter });
		const desc = graph.describe();
		const paths = Object.keys(desc.nodes);
		expect(paths).toContain("layout/graph-labels");
		expect(paths).toContain("layout/code-lines");
		expect(paths).toContain("layout/side-width-hint");
	});

	it("layout/graph-labels measures demo graph node labels", () => {
		const adapter = new CliMeasureAdapter();
		const shell = demoShell({ adapter });
		// Subscribe to the full chain: graph/describe → layout/graph-labels
		subscribePath(shell, "graph/describe");
		subscribePath(shell, "layout/graph-labels");

		const demo = new Graph("test-demo");
		demo.add("counter", state(1, { name: "counter" }));
		demo.add(
			"display",
			derived([demo.node("counter")!], ([v]) => v, { name: "display" }),
		);
		demo.connect("counter", "display");
		shell.setDemoGraph(demo);
		shell.bumpGraphTick();

		const labels = shell.graph.get("layout/graph-labels") as Map<string, GraphLabelSize>;
		expect(labels).toBeInstanceOf(Map);
		expect(labels.size).toBe(2);
		expect(labels.has("counter")).toBe(true);
		expect(labels.has("display")).toBe(true);
		const counterSize = labels.get("counter")!;
		expect(counterSize.width).toBeGreaterThan(0);
		expect(counterSize.height).toBeGreaterThan(0);
	});

	it("layout/graph-labels is empty map when no demo graph", () => {
		const adapter = new CliMeasureAdapter();
		const shell = demoShell({ adapter });
		subscribePath(shell, "graph/describe");
		subscribePath(shell, "layout/graph-labels");

		const labels = shell.graph.get("layout/graph-labels") as Map<string, GraphLabelSize>;
		expect(labels).toBeInstanceOf(Map);
		expect(labels.size).toBe(0);
	});

	it("layout/code-lines breaks text into lines", () => {
		const adapter = new CliMeasureAdapter();
		const shell = demoShell({ adapter });
		subscribePath(shell, "layout/code-lines");

		shell.setCodeText("hello world");
		const result = shell.graph.get("layout/code-lines") as LineBreaksResult;
		expect(result.lineCount).toBeGreaterThanOrEqual(1);
		expect(result.lines.length).toBeGreaterThanOrEqual(1);
	});

	it("layout/code-lines returns empty for empty text", () => {
		const adapter = new CliMeasureAdapter();
		const shell = demoShell({ adapter });
		subscribePath(shell, "layout/code-lines");

		const result = shell.graph.get("layout/code-lines") as LineBreaksResult;
		expect(result.lineCount).toBe(0);
		expect(result.lines).toEqual([]);
	});

	it("layout/side-width-hint derives from graph label widths", () => {
		const adapter = new CliMeasureAdapter();
		const shell = demoShell({ adapter });
		subscribePath(shell, "graph/describe");
		subscribePath(shell, "layout/graph-labels");
		subscribePath(shell, "layout/side-width-hint");

		// No demo graph → default minimum
		expect(shell.graph.get("layout/side-width-hint")).toBe(200);

		const demo = new Graph("test-demo");
		demo.add("short", state(1, { name: "short" }));
		demo.add("a-much-longer-node-name", state(2, { name: "a-much-longer-node-name" }));
		shell.setDemoGraph(demo);
		shell.bumpGraphTick();

		const hint = shell.graph.get("layout/side-width-hint") as number;
		expect(hint).toBeGreaterThanOrEqual(200);
	});

	// ── Cross-highlighting effect nodes ──────────────────

	it("effect nodes are absent without onHighlight", () => {
		const { graph } = demoShell();
		const paths = Object.keys(graph.describe().nodes);
		expect(paths).not.toContain("highlight/apply-code-scroll");
		expect(paths).not.toContain("highlight/apply-visual");
		expect(paths).not.toContain("highlight/apply-graph");
	});

	it("effect nodes are created when onHighlight callbacks provided", () => {
		const onHighlight: HighlightCallbacks = {
			codeScroll: () => {},
			visual: () => {},
			graph: () => {},
		};
		const { graph } = demoShell({ onHighlight });
		const paths = Object.keys(graph.describe().nodes);
		expect(paths).toContain("highlight/apply-code-scroll");
		expect(paths).toContain("highlight/apply-visual");
		expect(paths).toContain("highlight/apply-graph");
	});

	it("effect nodes invoke callbacks on hover target change", () => {
		const codeScrollCb = vi.fn();
		const visualCb = vi.fn();
		const graphCb = vi.fn();

		const registry: NodeRegistry = new Map([
			["myNode", { codeLine: 42, visualSelector: ".my-node" }],
		]);
		const shell = demoShell({
			nodeRegistry: registry,
			onHighlight: {
				codeScroll: codeScrollCb,
				visual: visualCb,
				graph: graphCb,
			},
		});

		// Subscribe to activate derived+effect chain
		subscribePath(shell, "highlight/apply-code-scroll");
		subscribePath(shell, "highlight/apply-visual");
		subscribePath(shell, "highlight/apply-graph");

		shell.setHoverTarget({ pane: "graph", id: "myNode" });
		expect(codeScrollCb).toHaveBeenCalledWith(42);
		expect(visualCb).toHaveBeenCalledWith(".my-node");
		expect(graphCb).toHaveBeenCalledWith("myNode");

		shell.setHoverTarget(null);
		expect(codeScrollCb).toHaveBeenCalledWith(null);
		expect(visualCb).toHaveBeenCalledWith(null);
		expect(graphCb).toHaveBeenCalledWith(null);
	});

	it("partial onHighlight creates only specified effect nodes", () => {
		const { graph } = demoShell({ onHighlight: { graph: () => {} } });
		const paths = Object.keys(graph.describe().nodes);
		expect(paths).not.toContain("highlight/apply-code-scroll");
		expect(paths).not.toContain("highlight/apply-visual");
		expect(paths).toContain("highlight/apply-graph");
	});

	// ── Batch helper ─────────────────────────────────────

	it("batch() prevents intermediate recomputes", () => {
		const shell = demoShell({ mainRatio: 0.5, viewportWidth: 1000 });
		let computeCount = 0;

		// Track recomputes on main-width via observe
		const obs = shell.graph.observe("pane/main-width");
		obs.subscribe(() => {
			computeCount++;
		});

		// Reset count after initial subscription fires
		computeCount = 0;

		shell.batch(() => {
			shell.setViewportWidth(1920);
			shell.setMainRatio(0.7);
		});

		// After batch: final value must be correct
		expect(shell.graph.get("pane/main-width")).toBe(Math.round(1920 * 0.7));
		expect(computeCount).toBeGreaterThanOrEqual(1);
	});

	it("batch() is available on the handle", () => {
		const shell = demoShell();
		expect(typeof shell.batch).toBe("function");
	});

	// ── Destroy ──────────────────────────────────────────

	it("destroy() tears down cleanly", () => {
		const shell = demoShell();
		expect(() => shell.destroy()).not.toThrow();
	});
});

// ── Test helper ──────────────────────────────────────────

/** Subscribe to a node path to activate lazy derived computation. */
function subscribePath(shell: DemoShellHandle, path: string): () => void {
	const obs = shell.graph.observe(path);
	return obs.subscribe(() => {});
}

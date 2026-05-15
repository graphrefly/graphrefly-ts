import type { Graph } from "@graphrefly/graphrefly";
import {
	type DemoShellHandle,
	demoShell,
	type NodeRegistry,
} from "@graphrefly/graphrefly/utils/demo-shell";
import { getMeasurementAdapter, LAYOUT_FONT } from "./measure-adapter.js";

/**
 * Single mutable registry. `demoShell()` captures it by reference at creation
 * time; its `highlight/code-scroll` / `highlight/visual` derived nodes read
 * through it on every fire, so clearing + repopulating this Map is enough to
 * re-point cross-highlighting to the new chapter.
 */
const liveRegistry: NodeRegistry = new Map();

let shell: DemoShellHandle | null = null;

/** Page-level singleton (created once per mount). */
export function getShell(viewportWidth?: number): DemoShellHandle {
	if (!shell) {
		shell = demoShell({
			mainRatio: 0.58,
			viewportWidth: viewportWidth ?? window.innerWidth,
			adapter: getMeasurementAdapter(),
			layoutFont: LAYOUT_FONT,
			nodeRegistry: liveRegistry,
		});
	}
	return shell;
}

/**
 * Atomically repoint the shell at a chapter's graph + source + registry.
 * The `batch()` coalesces every state write so downstream derived nodes
 * (`graph/mermaid`, `layout/code-lines`, `highlight/*`) fire once per tab
 * switch — the same batching story chapter C demonstrates in the main pane.
 */
export function focusChapter(
	s: DemoShellHandle,
	chapter: { graph: Graph; sourceCode: string; registry: NodeRegistry },
): void {
	s.batch(() => {
		liveRegistry.clear();
		for (const [k, v] of chapter.registry) liveRegistry.set(k, v);
		s.setDemoGraph(chapter.graph);
		s.setCodeText(chapter.sourceCode);
		s.selectNode(null);
		s.setHoverTarget(null);
		s.bumpGraphTick();
	});
}

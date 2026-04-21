import type { Graph } from "@graphrefly/graphrefly/graph";
import {
	type DemoShellHandle,
	demoShell,
	type NodeRegistry,
} from "@graphrefly/graphrefly/patterns/demo-shell";
import { type LazyAdapterHandle, lazyAdapter } from "./lazy-adapter.js";

const liveRegistry: NodeRegistry = new Map();

let shell: DemoShellHandle | null = null;
let sharedAdapter: LazyAdapterHandle | null = null;

/**
 * One LLM adapter shared across every chapter that does extraction. Probes
 * Chrome Nano on first invoke and routes there if available; falls back to
 * the mock heuristic otherwise. Same instance per page load so chapter 2,
 * 3, and 4 all see identical extraction behaviour and the user sees one
 * banner state across tab switches.
 */
export function getSharedAdapter(): LazyAdapterHandle {
	if (!sharedAdapter) sharedAdapter = lazyAdapter();
	return sharedAdapter;
}

/** Page-level singleton (created once per mount). */
export function getShell(viewportWidth?: number): DemoShellHandle {
	if (!shell) {
		shell = demoShell({
			mainRatio: 0.6,
			viewportWidth: viewportWidth ?? window.innerWidth,
			nodeRegistry: liveRegistry,
		});
	}
	return shell;
}

/**
 * Atomically repoint the shell at a chapter's graph + source + registry.
 * Same pattern as the reactive-layout demo: one batch, downstream derived
 * nodes (`graph/mermaid`, `highlight/*`) fire once per tab switch.
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

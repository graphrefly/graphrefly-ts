import type { Graph } from "@graphrefly/graphrefly/graph";
import {
	type DemoShellHandle,
	demoShell,
	type NodeRegistry,
} from "@graphrefly/graphrefly/patterns/demo-shell";

const liveRegistry: NodeRegistry = new Map();
let shell: DemoShellHandle | null = null;

export function getShell(viewportWidth?: number): DemoShellHandle {
	if (!shell) {
		shell = demoShell({
			mainRatio: 0.65,
			viewportWidth: viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280),
			nodeRegistry: liveRegistry,
		});
	}
	return shell;
}

export function setDemoGraph(s: DemoShellHandle, g: Graph): void {
	s.batch(() => {
		liveRegistry.clear();
		s.setDemoGraph(g);
		s.selectNode(null);
		s.setHoverTarget(null);
		s.bumpGraphTick();
	});
}

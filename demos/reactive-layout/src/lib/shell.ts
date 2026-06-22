import type { Node } from "@graphrefly/ts/core";
import { batch } from "@graphrefly/ts/core";
import { type Graph, graph } from "@graphrefly/ts/graph";
import { describeToMermaid } from "@graphrefly/ts/render";

export type HoverTarget = { pane: "visual" | "graph" | "code"; id: string } | null;

export type NodeRegistryEntry = {
	readonly codeLine?: number | null;
	readonly visualSelector?: string | null;
};

export type NodeRegistry = Map<string, NodeRegistryEntry>;

export type DemoShellHandle = {
	readonly graph: Graph;
	batch<T>(fn: () => T): T;
	setDemoGraph(graph: Graph): void;
	setCodeText(source: string): void;
	selectNode(path: string | null): void;
	setHoverTarget(target: HoverTarget): void;
	setMainRatio(ratio: number): void;
	setSideSplit(ratio: number): void;
	setViewportWidth(width: number): void;
	bumpGraphTick(): void;
};

type NodeDetail = {
	path: string;
	kind?: string;
	value?: unknown;
	status?: string;
};

const liveRegistry: NodeRegistry = new Map();
let shell: DemoShellHandle | null = null;

function registryEntry(id: string | null): NodeRegistryEntry | undefined {
	if (id === null) return undefined;
	const exact = liveRegistry.get(id);
	if (exact) return exact;
	for (const [key, value] of liveRegistry) {
		if (id.endsWith(`:${key}`) || id.includes(key) || key.includes(id)) return value;
	}
	return undefined;
}

function findNode(g: Graph | null, id: string | null): Node<unknown> | undefined {
	if (g === null || id === null) return undefined;
	const exact = g.find(id);
	if (exact) return exact;
	const local = g.find(id.replace(/^.*:/, ""));
	if (local) return local;
	const described = g
		.describe()
		.nodes.find((node) => id.endsWith(`:${node.id}`) || node.id.endsWith(`:${id}`));
	return described ? g.find(described.id) : undefined;
}

function nodeDetail(g: Graph | null, id: string | null): NodeDetail | null {
	const node = findNode(g, id);
	if (!node || id === null) return null;
	const described = g
		?.describe()
		.nodes.find((entry) => entry.id === id || id.endsWith(`:${entry.id}`));
	return {
		path: described?.id ?? id,
		kind: described?.factory,
		value: node.cache,
		status: node.status,
	};
}

export function getShell(viewportWidth?: number): DemoShellHandle {
	if (shell) return shell;
	const g = graph({ name: "reactive-layout-demo-shell" });
	const demoGraph = g.state<Graph | null>(null, { name: "graph/current" });
	const sourceCode = g.state("", { name: "source/code" });
	const selectedNode = g.state<string | null>(null, { name: "selected/node" });
	const hoverTarget = g.state<HoverTarget>(null, { name: "hover/target" });
	const mainRatio = g.state(0.58, { name: "layout/main-ratio" });
	const sideSplit = g.state(0.5, { name: "layout/side-split" });
	const viewport = g.state(viewportWidth ?? window.innerWidth, { name: "layout/viewport-width" });
	const graphTick = g.state(0, { name: "graph/tick" });

	g.derived(
		[demoGraph, graphTick],
		(current) => {
			if (current === null) return "";
			return describeToMermaid(current.describe(), { direction: "TD" });
		},
		{ name: "graph/mermaid" },
	);
	g.derived(
		[hoverTarget, selectedNode, graphTick],
		(hover, selected) => {
			const id = hover?.id ?? selected;
			return registryEntry(id)?.codeLine ?? null;
		},
		{ name: "highlight/code-scroll" },
	);
	g.derived(
		[demoGraph, hoverTarget, selectedNode, graphTick],
		(current, hover, selected) => {
			return nodeDetail(current, hover?.id ?? selected);
		},
		{ name: "inspect/node-detail" },
	);

	shell = {
		graph: g,
		batch,
		setDemoGraph: (next) => demoGraph.set(next),
		setCodeText: (next) => sourceCode.set(next),
		selectNode: (next) => selectedNode.set(next),
		setHoverTarget: (next) => hoverTarget.set(next),
		setMainRatio: (next) => mainRatio.set(next),
		setSideSplit: (next) => sideSplit.set(next),
		setViewportWidth: (next) => viewport.set(next),
		bumpGraphTick: () => graphTick.set(((graphTick.cache as number | undefined) ?? 0) + 1),
	};
	return shell;
}

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

import { type Graph, graph, type Node } from "@graphrefly/ts/graph";
import { describeToMermaid } from "@graphrefly/ts/render";
import {
	analyzeAndMeasure,
	computeLineBreaks,
	type LineBreaksResult,
	type MeasurementAdapter,
} from "@graphrefly/ts/solutions/reactive-layout";

export interface DemoShellGraph {
	resolve<T = unknown>(id: string): Node<T>;
}

export interface DemoShellHandle {
	graph: DemoShellGraph;
	setDemoGraph(graph: Graph): void;
	bumpGraphTick(): void;
	setViewportWidth(width: number): void;
	setMainRatio(ratio: number): void;
	setSideSplit(ratio: number): void;
	setCodeText(text: string): void;
	selectNode(nodeId: string | null): void;
	destroy(): void;
}

export interface DemoShellOptions {
	mainRatio: number;
	viewportWidth: number;
	adapter?: MeasurementAdapter | null;
	layoutFont?: string;
}

export function demoShell(opts: DemoShellOptions): DemoShellHandle {
	const shell = graph({ name: "compat-matrix/demo-shell" });
	const demoGraphRef = { current: null as Graph | null };
	const graphTick = shell.state(0, { name: "shell/graph-tick" });
	const selectedNode = shell.state<string | null>(null, { name: "shell/selected-node" });
	const viewportWidth = shell.state(opts.viewportWidth, { name: "shell/viewport-width" });
	const mainRatio = shell.state(opts.mainRatio, { name: "shell/main-ratio" });
	const codeText = shell.state("", { name: "shell/code-text" });

	const mermaidNode = shell.derived(
		[graphTick, selectedNode],
		(_tick, selected) => {
			const source = demoGraphRef.current;
			if (!source) return "flowchart LR";
			const rendered = describeToMermaid(source.describe(), { direction: "LR" });
			return selected ? `${rendered}\n%% selected: ${selected}` : rendered;
		},
		{ name: "graph/mermaid" },
	);

	const graphHeightRatio = shell.state(0.5, { name: "pane/graph-height-ratio" });
	const codeLines = shell.derived(
		[codeText, viewportWidth, mainRatio],
		(text, width, ratio): LineBreaksResult | null => {
			if (!opts.adapter || !text) return null;
			const cache = new Map<string, Map<string, number>>();
			const maxWidth = Math.max(120, Math.round((width ?? 0) * (1 - (ratio ?? 0.6)) - 32));
			const font = opts.layoutFont ?? '13px "Fira Code", ui-monospace, monospace';
			const segments = analyzeAndMeasure(text, font, opts.adapter, cache);
			return computeLineBreaks(segments, maxWidth, opts.adapter, font, cache);
		},
		{ name: "layout/code-lines" },
	);

	const nodes = new Map<string, Node<unknown>>([
		["graph/mermaid", mermaidNode],
		["pane/graph-height-ratio", graphHeightRatio],
		["layout/code-lines", codeLines],
	]);

	return {
		graph: {
			resolve<T = unknown>(id: string): Node<T> {
				const node = nodes.get(id);
				if (!node) throw new Error(`demoShell: unknown node '${id}'`);
				return node as Node<T>;
			},
		},
		setDemoGraph(nextGraph) {
			demoGraphRef.current = nextGraph;
			graphTick.set((graphTick.cache ?? 0) + 1);
		},
		bumpGraphTick() {
			graphTick.set((graphTick.cache ?? 0) + 1);
		},
		setViewportWidth(width) {
			viewportWidth.set(width);
		},
		setMainRatio(ratio) {
			mainRatio.set(ratio);
		},
		setSideSplit(ratio) {
			graphHeightRatio.set(ratio);
		},
		setCodeText(text) {
			codeText.set(text);
		},
		selectNode(nodeId) {
			selectedNode.set(nodeId);
			graphTick.set((graphTick.cache ?? 0) + 1);
		},
		destroy() {},
	};
}

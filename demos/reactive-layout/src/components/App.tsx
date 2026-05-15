import type { DemoShellHandle, HoverTarget } from "@graphrefly/graphrefly/utils/demo-shell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAdaptersChapter } from "../lib/chapters/adapters";
import { buildBatchChapter } from "../lib/chapters/batch";
import { buildBlocksChapter } from "../lib/chapters/blocks";
import { buildFlowChapter } from "../lib/chapters/flow";
import { buildPlaygroundChapter } from "../lib/chapters/playground";
import { buildRecomputesChapter } from "../lib/chapters/recomputes";
import type { Chapter } from "../lib/chapters/types";
import { focusChapter, getShell } from "../lib/shell";
import CodePane from "./CodePane";
import AdaptersChapterUI, { getAdaptersChapter } from "./chapters/AdaptersChapter";
import BatchChapterUI, { getBatchChapter } from "./chapters/BatchChapter";
import BlocksChapterUI, { getBlocksChapter } from "./chapters/BlocksChapter";
import FlowChapterUI, { getFlowChapter } from "./chapters/FlowChapter";
import PlaygroundChapterUI, { getPlaygroundChapter } from "./chapters/PlaygroundChapter";
import RecomputesChapterUI, { getRecomputesChapter } from "./chapters/RecomputesChapter";
import GraphPane from "./GraphPane";
import InspectStrip from "./InspectStrip";

// The getX helpers memoize the underlying chapter builders — they run once per
// page. The `buildX` imports are retained above to keep them in the dependency
// graph (tree-shaking safe) and so a consumer reading this file sees the full
// chain, not just the memo wrapper.
void buildPlaygroundChapter;
void buildRecomputesChapter;
void buildBatchChapter;
void buildAdaptersChapter;
void buildBlocksChapter;
void buildFlowChapter;

const CHAPTERS: Chapter[] = [
	(() => {
		const c = getPlaygroundChapter();
		return {
			id: "playground",
			label: "Playground",
			tagline: "Edit text, width, font — only dependent derived nodes re-run.",
			graph: c.graph,
			sourceCode: c.sourceCode,
			registry: c.registry,
			UI: PlaygroundChapterUI,
		};
	})(),
	(() => {
		const c = getRecomputesChapter();
		return {
			id: "recomputes",
			label: "Recomputes",
			tagline: "Reactive fan-out vs. re-run-from-scratch baseline.",
			graph: c.bundle.graph,
			sourceCode: c.sourceCode,
			registry: c.registry,
			UI: RecomputesChapterUI,
		};
	})(),
	(() => {
		const c = getBatchChapter();
		return {
			id: "batch",
			label: "Batch",
			tagline: "5 writes, 1 coalesced recompute via batch().",
			graph: c.batched.graph,
			sourceCode: c.sourceCode,
			registry: c.registry,
			UI: BatchChapterUI,
		};
	})(),
	(() => {
		const c = getAdaptersChapter();
		return {
			id: "adapters",
			label: "Adapters",
			tagline: "Same topology, three measurement backends.",
			graph: c.canvas.graph,
			sourceCode: c.sourceCode,
			registry: c.registry,
			UI: AdaptersChapterUI,
		};
	})(),
	(() => {
		const c = getBlocksChapter();
		return {
			id: "blocks",
			label: "Blocks",
			tagline: "Mixed content flow — text + SVG + image.",
			graph: c.bundle.graph,
			sourceCode: c.sourceCode,
			registry: c.registry,
			UI: BlocksChapterUI,
		};
	})(),
	(() => {
		const c = getFlowChapter();
		return {
			id: "flow",
			label: "Flow",
			tagline: "Two columns wrapping around moving ASCII obstacles (drag them).",
			graph: c.graph,
			sourceCode: c.sourceCode,
			registry: c.registry,
			UI: FlowChapterUI,
		};
	})(),
];

export default function App() {
	const shellRef = useRef<DemoShellHandle | null>(null);
	const sidePaneRef = useRef<HTMLDivElement | null>(null);
	const [chapterId, setChapterId] = useState<string>(CHAPTERS[0]!.id);
	const activeChapter = useMemo(
		() => CHAPTERS.find((c) => c.id === chapterId) ?? CHAPTERS[0]!,
		[chapterId],
	);

	const [mainRatio, setMainRatio] = useState(0.58);
	const [graphRatio, setGraphRatio] = useState(0.5);
	const [mermaidText, setMermaidText] = useState("");
	const [hoverTarget, setHoverTarget] = useState<HoverTarget>(null);
	const [highlightLine, setHighlightLine] = useState<number | null>(null);

	// Init shell once. Initial chapter focus is handled by the
	// `[activeChapter]` effect below — no stale-closure risk from omitting it
	// here.
	useEffect(() => {
		const shell = getShell();
		shellRef.current = shell;

		const mermaidNode = shell.graph.resolve("graph/mermaid");
		const codeScrollNode = shell.graph.resolve("highlight/code-scroll");
		const hoverNode = shell.graph.resolve("hover/target");

		const u1 = mermaidNode.subscribe(() => {
			setMermaidText((mermaidNode.cache as string) ?? "");
		});
		setMermaidText((mermaidNode.cache as string) ?? "");

		const u2 = codeScrollNode.subscribe(() => {
			setHighlightLine((codeScrollNode.cache as number | null) ?? null);
		});
		const u3 = hoverNode.subscribe(() => {
			setHoverTarget((hoverNode.cache as HoverTarget) ?? null);
		});

		const onResize = () => shell.setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);

		return () => {
			u1();
			u2();
			u3();
			window.removeEventListener("resize", onResize);
		};
	}, []);

	// Re-point shell on chapter change.
	useEffect(() => {
		const shell = shellRef.current;
		if (!shell) return;
		focusChapter(shell, activeChapter);
	}, [activeChapter]);

	// Push hover from UI → shell.
	const onHover = useCallback((t: HoverTarget) => {
		shellRef.current?.setHoverTarget(t);
	}, []);
	const onSelect = useCallback((path: string | null) => {
		shellRef.current?.selectNode(path);
	}, []);

	// Drag handlers — main/side split.
	const draggingMain = useRef(false);
	const draggingSplit = useRef(false);
	const onMainDividerDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		draggingMain.current = true;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		const onMove = (ev: MouseEvent) => {
			if (!draggingMain.current) return;
			const ratio = Math.max(0.25, Math.min(0.8, ev.clientX / window.innerWidth));
			setMainRatio(ratio);
			shellRef.current?.setMainRatio(ratio);
		};
		const onUp = () => {
			draggingMain.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}, []);
	const onSplitDividerDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		draggingSplit.current = true;
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
		const onMove = (ev: MouseEvent) => {
			if (!draggingSplit.current || !sidePaneRef.current) return;
			const rect = sidePaneRef.current.getBoundingClientRect();
			const ratio = Math.max(0.15, Math.min(0.85, (ev.clientY - rect.top) / rect.height));
			setGraphRatio(ratio);
			shellRef.current?.setSideSplit(ratio);
		};
		const onUp = () => {
			draggingSplit.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}, []);

	const onHoverNodeFromGraph = useCallback((id: string | null) => {
		shellRef.current?.setHoverTarget(id ? { pane: "graph", id } : null);
	}, []);

	const UI = activeChapter.UI;
	const mainWidthPct = `${Math.round(mainRatio * 100)}%`;
	const sideWidthPct = `${Math.round((1 - mainRatio) * 100)}%`;

	return (
		<div className="app">
			<div className="tab-bar">
				{CHAPTERS.map((c) => (
					<button
						key={c.id}
						type="button"
						className={`tab${c.id === chapterId ? " active" : ""}`}
						onClick={() => setChapterId(c.id)}
						title={c.tagline}
					>
						{c.label}
					</button>
				))}
				<div className="tab-tagline">{activeChapter.tagline}</div>
			</div>

			<div className="demo-shell">
				<div className="pane-main" style={{ width: mainWidthPct, maxWidth: mainWidthPct }}>
					<UI hoverTarget={hoverTarget} onHover={onHover} onSelect={onSelect} />
				</div>
				<div className="pane-divider" onMouseDown={onMainDividerDown} title="Drag to resize" />
				<div className="pane-side" ref={sidePaneRef} style={{ width: sideWidthPct }}>
					<div className="pane-graph" style={{ height: `${graphRatio * 100}%` }}>
						<h3>Graph topology — describe() → mermaid</h3>
						<GraphPane
							text={mermaidText}
							hoverId={hoverTarget?.id ?? null}
							onHoverNode={onHoverNodeFromGraph}
						/>
					</div>
					<div
						className="pane-split-divider"
						onMouseDown={onSplitDividerDown}
						title="Drag to resize"
					/>
					<div className="pane-code">
						<h3>Source — this is the code that built the graph</h3>
						<CodePane source={activeChapter.sourceCode} highlightLine={highlightLine} />
					</div>
				</div>
			</div>

			<InspectStrip shell={shellRef.current ?? getShell()} activeGraph={activeChapter.graph} />
		</div>
	);
}

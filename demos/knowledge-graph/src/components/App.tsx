import type { DemoShellHandle, HoverTarget } from "@graphrefly/graphrefly/patterns/demo-shell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, ChapterResolved } from "../lib/chapters/types";
import { focusChapter, getShell } from "../lib/shell";
import CodePane from "./CodePane";
import BaselineChapterUI, { getBaselineChapter } from "./chapters/BaselineChapter";
import GuardChapterUI, { getGuardChapter } from "./chapters/GuardChapter";
import InspectChapterUI, { getInspectChapter } from "./chapters/InspectChapter";
import ReactiveChapterUI, { getReactiveChapterSync } from "./chapters/ReactiveChapter";
import GraphPane from "./GraphPane";
import InspectStrip from "./InspectStrip";

// Chapters declared with a `resolve()` thunk. The thunk only runs on first
// tab activation, so the demo doesn't pay the cost of constructing
// promptNode / policyEnforcer / reactiveExplainPath subgraphs for chapters
// the user never visits, and a runtime failure in one chapter's setup
// doesn't crash the whole app at module-load time.
const CHAPTERS: Chapter[] = [
	{
		id: "baseline",
		label: "1. Baseline",
		tagline: "knowledgeGraph() up close — looks like a fancy Map.",
		UI: BaselineChapterUI,
		resolve: () => {
			const c = getBaselineChapter();
			return { graph: c.graph, sourceCode: c.sourceCode, registry: c.registry };
		},
	},
	{
		id: "reactive",
		label: "2. Reactive turn",
		tagline: "Paper → promptNode → KG. The moment Graph beats Map.",
		UI: ReactiveChapterUI,
		resolve: () => {
			const c = getReactiveChapterSync();
			return { graph: c.graph, sourceCode: c.sourceCode, registry: c.registry };
		},
	},
	{
		id: "inspect",
		label: "3. Inspect & trace",
		tagline: "describe() + reactiveExplainPath() — ask why, get a chain.",
		UI: InspectChapterUI,
		resolve: () => {
			const c = getInspectChapter();
			return { graph: c.graph, sourceCode: c.sourceCode, registry: c.registry };
		},
	},
	{
		id: "guard",
		label: "4. Guardrails",
		tagline: "policyEnforcer wraps the KG — untrusted-llm writes throw.",
		UI: GuardChapterUI,
		resolve: () => {
			const c = getGuardChapter();
			return { graph: c.graph, sourceCode: c.sourceCode, registry: c.registry };
		},
	},
];

export default function App() {
	const shellRef = useRef<DemoShellHandle | null>(null);
	const sidePaneRef = useRef<HTMLDivElement | null>(null);
	const [chapterId, setChapterId] = useState<string>(CHAPTERS[1]!.id);
	const activeChapter = useMemo(
		() => CHAPTERS.find((c) => c.id === chapterId) ?? CHAPTERS[0]!,
		[chapterId],
	);
	// Resolve chapter graph/source/registry on activation. This is what makes
	// chapter construction lazy — the first time a tab is clicked, its
	// `resolve()` runs and the result is cached inside that chapter's module.
	const resolved: ChapterResolved = useMemo(() => activeChapter.resolve(), [activeChapter]);

	const [mainRatio, setMainRatio] = useState(0.6);
	const [graphRatio, setGraphRatio] = useState(0.5);
	const [mermaidText, setMermaidText] = useState("");
	const [hoverTarget, setHoverTarget] = useState<HoverTarget>(null);
	const [highlightLine, setHighlightLine] = useState<number | null>(null);

	useEffect(() => {
		const shell = getShell();
		shellRef.current = shell;

		const mermaidNode = shell.graph.resolve("graph/mermaid");
		const codeScrollNode = shell.graph.resolve("highlight/code-scroll");
		const hoverNode = shell.graph.resolve("hover/target");

		const u1 = mermaidNode.subscribe(() => {
			setMermaidText((mermaidNode.cache as string) ?? "");
		});
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

	useEffect(() => {
		const shell = shellRef.current;
		if (!shell) return;
		focusChapter(shell, resolved);
	}, [resolved]);

	const onHover = useCallback((t: HoverTarget) => {
		shellRef.current?.setHoverTarget(t);
	}, []);
	const onSelect = useCallback((path: string | null) => {
		shellRef.current?.selectNode(path);
	}, []);

	// Drag listeners: each `useEffect` registers + cleans up the active drag
	// session. A ref tracks the in-flight handlers so unmount during a drag
	// removes them from the window — fixes the "callbacks fire on a
	// dead component after route change / HMR" bug.
	const activeDragHandlers = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);
	useEffect(() => {
		return () => {
			if (activeDragHandlers.current) {
				window.removeEventListener("mousemove", activeDragHandlers.current.move);
				window.removeEventListener("mouseup", activeDragHandlers.current.up);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				activeDragHandlers.current = null;
			}
		};
	}, []);

	const beginDrag = useCallback(
		(cursor: "col-resize" | "row-resize", onMove: (e: MouseEvent) => void) => {
			document.body.style.cursor = cursor;
			document.body.style.userSelect = "none";
			const move = (ev: MouseEvent) => onMove(ev);
			const up = () => {
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				window.removeEventListener("mousemove", move);
				window.removeEventListener("mouseup", up);
				activeDragHandlers.current = null;
			};
			activeDragHandlers.current = { move, up };
			window.addEventListener("mousemove", move);
			window.addEventListener("mouseup", up);
		},
		[],
	);

	const onMainDividerDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			beginDrag("col-resize", (ev) => {
				const ratio = Math.max(0.25, Math.min(0.8, ev.clientX / window.innerWidth));
				setMainRatio(ratio);
				shellRef.current?.setMainRatio(ratio);
			});
		},
		[beginDrag],
	);
	const onSplitDividerDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			beginDrag("row-resize", (ev) => {
				if (!sidePaneRef.current) return;
				const rect = sidePaneRef.current.getBoundingClientRect();
				const ratio = Math.max(0.15, Math.min(0.85, (ev.clientY - rect.top) / rect.height));
				setGraphRatio(ratio);
				shellRef.current?.setSideSplit(ratio);
			});
		},
		[beginDrag],
	);

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
				{/** biome-ignore lint/a11y/noStaticElementInteractions: drag-resize handle, mouse-only */}
				<div
					className="pane-divider"
					onMouseDown={onMainDividerDown}
					title="Drag to resize main / side split"
				/>
				<div className="pane-side" ref={sidePaneRef} style={{ width: sideWidthPct }}>
					<div className="pane-graph" style={{ height: `${graphRatio * 100}%` }}>
						<h3>Graph topology — describe(graph) → mermaid</h3>
						<GraphPane
							text={mermaidText}
							hoverId={hoverTarget?.id ?? null}
							onHoverNode={onHoverNodeFromGraph}
						/>
					</div>
					{/** biome-ignore lint/a11y/noStaticElementInteractions: drag-resize handle, mouse-only */}
					<div
						className="pane-split-divider"
						onMouseDown={onSplitDividerDown}
						title="Drag to resize graph / code split"
					/>
					<div className="pane-code">
						<h3>Source — the code that built this chapter's graph</h3>
						<CodePane source={resolved.sourceCode} highlightLine={highlightLine} />
					</div>
				</div>
			</div>

			<InspectStrip shell={shellRef.current ?? getShell()} activeGraph={resolved.graph} />
		</div>
	);
}

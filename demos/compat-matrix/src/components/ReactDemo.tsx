import type { ReadableAtom, WritableAtom } from "@graphrefly/graphrefly/compat/jotai";
import type { NanoAtom, NanoComputed } from "@graphrefly/graphrefly/compat/nanostores";
import { useStore, useSubscribe, useSubscribeRecord } from "@graphrefly/graphrefly/compat/react";
import type { StoreApi } from "@graphrefly/graphrefly/compat/zustand";
import type { Node } from "@graphrefly/graphrefly/core";
import type { DemoShellHandle } from "@graphrefly/graphrefly/patterns/demo-shell";
import { demoShell } from "@graphrefly/graphrefly/patterns/demo-shell";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	counterGraph,
	counterNodeFactory,
	getCodeSnippets,
	jotaiCounter,
	jotaiDoubled,
	keysNode,
	leaderboardTotalHeight,
	nanoCounter,
	nanoDoubled,
	rawDoubledNode,
	rawNode,
	totalNode,
	zustandDoubledSelector,
	zustandStore,
} from "../lib/counter";
import {
	type CodeLayoutSummary,
	getMeasurementAdapter,
	hitTestCharacter,
	LAYOUT_FONT,
	summarizeCodeLines,
} from "../lib/layout-integration";
import { initMermaid, mermaid, nextMermaidId } from "../lib/mermaid-render";
import { attachPanZoom } from "../lib/pan-zoom";

// ── Custom hooks for non-React-native bindings ─────────────────────────

function useAtomValue<T>(atom: ReadableAtom<T> | WritableAtom<T>): T {
	return useSyncExternalStore(
		(onStoreChange) => atom.subscribe(() => onStoreChange()),
		() => atom.get(),
		() => atom.get(),
	);
}

function useNanoValue<T>(store: NanoAtom<T>): [T, (v: T) => void] {
	const value = useSyncExternalStore(
		(onStoreChange) => store.subscribe(() => onStoreChange()),
		() => store.get(),
		() => store.get(),
	);
	const set = useCallback((v: T) => store.set(v), [store]);
	return [value, set];
}

function useNanoComputed<T>(store: NanoComputed<T>): T {
	return useSyncExternalStore(
		(onStoreChange) => store.subscribe(() => onStoreChange()),
		() => store.get(),
		() => store.get(),
	);
}

function useZustandStore<T extends object>(store: StoreApi<T>): T {
	return useSyncExternalStore(
		(onStoreChange) => store.subscribe(() => onStoreChange()),
		() => store.getState(),
		() => store.getState(),
	);
}

function useZustandSelector<T extends object, R>(store: StoreApi<T>, selector: (s: T) => R): R {
	return useSyncExternalStore(
		(onStoreChange) => store.subscribe(() => onStoreChange()),
		() => selector(store.getState()),
		() => selector(store.getState()),
	);
}

// ── Counter card components ────────────────────────────────────────────

type LibName = "graphrefly" | "jotai" | "nanostores" | "zustand";

const LIB_LABELS: Record<LibName, string> = {
	graphrefly: "GraphReFly",
	jotai: "Jotai",
	nanostores: "Nanostores",
	zustand: "Zustand",
};

const LIB_DESCS: Record<LibName, string> = {
	graphrefly: "Direct node · useStore / useSubscribe",
	jotai: "Derived atom · atom(read, write)",
	nanostores: "Sync atom · bidirectional bridge",
	zustand: "Store API · create(initializer)",
};

function RawCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
	const [value, setValue] = useStore(rawNode as Node<number>);
	const count = (value as number) ?? 0;
	const doubled = useSubscribe(rawDoubledNode as Node<number>) as number | null;
	return (
		<div
			className={`counter-card${selected ? " selected" : ""}`}
			data-lib="graphrefly"
			onClick={onSelect}
		>
			<span className="lib-badge">GraphReFly</span>
			<div className="counter-display">
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						setValue(count - 1);
					}}
				>
					−
				</button>
				<span className="counter-value">{count}</span>
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						setValue(count + 1);
					}}
				>
					+
				</button>
			</div>
			<p className="counter-desc">{LIB_DESCS.graphrefly}</p>
			<p className="counter-derived">
				<span className="derived-label">derived()</span>
				<span className="derived-value">doubled = {doubled ?? 0}</span>
			</p>
		</div>
	);
}

function JotaiCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
	const value = useAtomValue(jotaiCounter);
	const count = value ?? 0;
	const doubled = useAtomValue(jotaiDoubled) ?? 0;
	return (
		<div
			className={`counter-card${selected ? " selected" : ""}`}
			data-lib="jotai"
			onClick={onSelect}
		>
			<span className="lib-badge">Jotai</span>
			<div className="counter-display">
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						jotaiCounter.set(count - 1);
					}}
				>
					−
				</button>
				<span className="counter-value">{count}</span>
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						jotaiCounter.set(count + 1);
					}}
				>
					+
				</button>
			</div>
			<p className="counter-desc">{LIB_DESCS.jotai}</p>
			<p className="counter-derived">
				<span className="derived-label">atom(get =&gt; ...)</span>
				<span className="derived-value">doubled = {doubled}</span>
			</p>
		</div>
	);
}

function NanoCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
	const [count, setCount] = useNanoValue(nanoCounter);
	const doubled = useNanoComputed(nanoDoubled) ?? 0;
	return (
		<div
			className={`counter-card${selected ? " selected" : ""}`}
			data-lib="nanostores"
			onClick={onSelect}
		>
			<span className="lib-badge">Nanostores</span>
			<div className="counter-display">
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						setCount(count - 1);
					}}
				>
					−
				</button>
				<span className="counter-value">{count}</span>
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						setCount(count + 1);
					}}
				>
					+
				</button>
			</div>
			<p className="counter-desc">{LIB_DESCS.nanostores}</p>
			<p className="counter-derived">
				<span className="derived-label">computed(atom, fn)</span>
				<span className="derived-value">doubled = {doubled}</span>
			</p>
		</div>
	);
}

function ZustandCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
	const state = useZustandStore(zustandStore);
	const count = state?.count ?? 0;
	const doubled = useZustandSelector(zustandStore, zustandDoubledSelector);
	return (
		<div
			className={`counter-card${selected ? " selected" : ""}`}
			data-lib="zustand"
			onClick={onSelect}
		>
			<span className="lib-badge">Zustand</span>
			<div className="counter-display">
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						state?.dec();
					}}
				>
					−
				</button>
				<span className="counter-value">{count}</span>
				<button
					className="counter-btn"
					onClick={(e) => {
						e.stopPropagation();
						state?.inc();
					}}
				>
					+
				</button>
			</div>
			<p className="counter-desc">{LIB_DESCS.zustand}</p>
			<p className="counter-derived">
				<span className="derived-label">selector(state)</span>
				<span className="derived-value">doubled = {doubled}</span>
			</p>
		</div>
	);
}

// ── Leaderboard ────────────────────────────────────────────────────────

function Leaderboard({
	selected,
	onSelect,
}: {
	selected: LibName | "leaderboard" | null;
	onSelect: (lib: LibName | "leaderboard") => void;
}) {
	const record = useSubscribeRecord(
		keysNode as Node<string[]>,
		counterNodeFactory as (key: string) => { count: Node<number> },
	);
	const total = useSubscribe(totalNode as Node<number>);

	return (
		<div
			className={`leaderboard${selected === "leaderboard" ? " selected" : ""}`}
			onClick={() => onSelect("leaderboard")}
		>
			<div className="leaderboard-title">Leaderboard — useSubscribeRecord</div>
			<div className="leaderboard-rows">
				{(["graphrefly", "jotai", "nanostores", "zustand"] as LibName[]).map((lib) => (
					<button
						type="button"
						key={lib}
						className={`leaderboard-row${selected === lib ? " selected" : ""}`}
						data-lib-row={lib}
						onClick={(e) => {
							e.stopPropagation();
							onSelect(lib);
						}}
					>
						<span className="leaderboard-key" data-lib={lib}>
							{LIB_LABELS[lib]}
						</span>
						<span className="leaderboard-val">{record[lib]?.count ?? 0}</span>
					</button>
				))}
			</div>
			<div className="total-line">
				Total: <strong>{(total as number) ?? 0}</strong>
			</div>
		</div>
	);
}

// ── Mermaid graph (React-native rendering via useEffect) ───────────────

function MermaidGraph({ text }: { text: string }) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		initMermaid();
		if (!containerRef.current) return;
		return attachPanZoom(containerRef.current);
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		if (!text) {
			el.innerHTML = "";
			return;
		}
		let cancelled = false;
		mermaid
			.render(nextMermaidId(), text)
			.then(({ svg, bindFunctions }) => {
				if (cancelled || !containerRef.current) return;
				containerRef.current.innerHTML = svg;
				bindFunctions?.(containerRef.current);
			})
			.catch((err) => {
				if (cancelled || !containerRef.current) return;
				console.warn("[MermaidGraph] render failed:", err);
				containerRef.current.textContent = text;
			});
		return () => {
			cancelled = true;
		};
	}, [text]);

	return <div ref={containerRef} className="mermaid-graph" />;
}

// ── Main demo ──────────────────────────────────────────────────────────

const codeSnippets = getCodeSnippets("react");

export default function ReactDemo() {
	const shellRef = useRef<DemoShellHandle | null>(null);
	const sidePaneRef = useRef<HTMLDivElement | null>(null);
	const [selectedLib, setSelectedLib] = useState<LibName | "leaderboard" | null>(null);

	// Pane split state for drag resize
	const [mainRatio, setMainRatio] = useState(0.6);
	const [graphRatio, setGraphRatio] = useState(0.5);
	const draggingRef = useRef(false);
	const draggingSplitRef = useRef(false);

	// Shell nodes for mermaid text
	const [mermaidText, setMermaidText] = useState("");
	// Reactive layout state: driven by `layout/code-lines` (#1) + leaderboard
	// block-flow total height (#2). Re-wraps when side-pane width changes.
	const [codeLayout, setCodeLayout] = useState<CodeLayoutSummary>({ lineCount: 0, maxWidth: 0 });
	const [leaderboardH, setLeaderboardH] = useState(0);
	// (#3) Grapheme hit from last code-pane click — "which character did I hit".
	const [codeHit, setCodeHit] = useState<{ line: number; graphemeIndex: number } | null>(null);

	// Create shell once
	useEffect(() => {
		// (#1) Pass a CanvasMeasureAdapter so the shell's `layout/code-lines`
		// derived node (and `layout/graph-labels`) turn on — otherwise
		// those paths are dormant per demo-shell.ts:343.
		const shell = demoShell({
			mainRatio: 0.6,
			viewportWidth: window.innerWidth,
			adapter: getMeasurementAdapter(),
			layoutFont: LAYOUT_FONT,
		});
		shellRef.current = shell;
		shell.setDemoGraph(counterGraph);
		shell.bumpGraphTick();

		// Subscribe to mermaid node via raw subscribe (headless)
		const mermaidNode = shell.graph.resolve("graph/mermaid");
		const unsub = mermaidNode.subscribe(() => {
			setMermaidText((mermaidNode.cache as string) ?? "");
		});
		setMermaidText((mermaidNode.cache as string) ?? "");

		// Subscribe to the reactive graph/code split ratio so UI mirrors
		// whatever state the shell emits (pan, fullscreen, etc.).
		const graphRatioNode = shell.graph.resolve("pane/graph-height-ratio");
		const unsubGraphRatio = graphRatioNode.subscribe(() => {
			setGraphRatio((graphRatioNode.cache as number) ?? 0.5);
		});
		setGraphRatio((graphRatioNode.cache as number) ?? 0.5);

		// (#1) Subscribe to the shell's reactive code-lines layout. Recomputes
		// whenever the code text (`shell.setCodeText`) or the side-pane
		// width (`paneSideWidth` = viewport - main) changes.
		const codeLinesNode = shell.graph.resolve("layout/code-lines");
		const unsubCodeLines = codeLinesNode.subscribe(() => {
			setCodeLayout(
				summarizeCodeLines(codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0]),
			);
		});
		setCodeLayout(
			summarizeCodeLines(codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0]),
		);

		// (#2) Leaderboard total height from reactiveBlockLayout. For 4 fixed
		// rows this is static, but subscribe anyway — the plumbing is what
		// matters and the node stays live if keys change at runtime.
		const unsubLeaderboardH = leaderboardTotalHeight.subscribe(() => {
			setLeaderboardH((leaderboardTotalHeight.cache as number) ?? 0);
		});
		setLeaderboardH((leaderboardTotalHeight.cache as number) ?? 0);

		// Track viewport width
		const onResize = () => shell.setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);

		return () => {
			unsub();
			unsubGraphRatio();
			unsubCodeLines();
			unsubLeaderboardH();
			window.removeEventListener("resize", onResize);
			shell.destroy();
		};
	}, []);

	// Drag divider handlers
	const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		draggingRef.current = true;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const onMove = (ev: MouseEvent) => {
			if (!draggingRef.current) return;
			const ratio = Math.max(0.2, Math.min(0.85, ev.clientX / window.innerWidth));
			setMainRatio(ratio);
			shellRef.current?.setMainRatio(ratio);
		};
		const onUp = () => {
			draggingRef.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}, []);

	// Drag graph/code split (vertical divider within the side pane).
	// Uses the side pane's own bounding rect so the split stays sensible
	// even if the side pane is resized (zoomed browser, different viewport).
	const onSplitMouseDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		draggingSplitRef.current = true;
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";

		const onMove = (ev: MouseEvent) => {
			if (!draggingSplitRef.current || !sidePaneRef.current) return;
			const rect = sidePaneRef.current.getBoundingClientRect();
			const ratio = Math.max(0.1, Math.min(0.9, (ev.clientY - rect.top) / rect.height));
			shellRef.current?.setSideSplit(ratio);
		};
		const onUp = () => {
			draggingSplitRef.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}, []);

	const handleSelect = (lib: LibName | "leaderboard") => {
		setSelectedLib(lib);
		// (#1) Feed the chosen snippet into the shell so `layout/code-lines`
		// recomputes reactively. Everything downstream (pane header summary,
		// char hit-test) reads from this single state change.
		const snippet = codeSnippets[lib] ?? "";
		shellRef.current?.setCodeText(snippet);
		setCodeHit(null);
		if (lib === "leaderboard") {
			shellRef.current?.selectNode("counter-keys");
			return;
		}
		const nodeMap: Record<LibName, string> = {
			graphrefly: "graphrefly/count",
			jotai: "jotai/count",
			nanostores: "nanostores/count",
			zustand: "zustand/count",
		};
		shellRef.current?.selectNode(nodeMap[lib]);
	};

	const codeKey = selectedLib ?? null;
	const codeSnippet = codeKey ? codeSnippets[codeKey] : null;
	const codeTitle = codeKey
		? codeKey === "leaderboard"
			? "Leaderboard — useSubscribeRecord code"
			: `${LIB_LABELS[codeKey as LibName]} — binding code`
		: "Select a card to see code";

	// (#3) Code-pane click → char hit-test via `computeCharPositions`.
	const onCodePaneClick = useCallback(
		(e: React.MouseEvent<HTMLPreElement>) => {
			if (!codeKey) return;
			const snippet = codeSnippets[codeKey];
			if (!snippet) return;
			const rect = e.currentTarget.getBoundingClientRect();
			const padding = 16; // matches `.code-pre` padding
			const hit = hitTestCharacter(
				snippet,
				Math.max(100, rect.width - padding * 2),
				e.clientX - rect.left - padding,
				e.clientY - rect.top - padding,
			);
			if (hit) setCodeHit({ line: hit.line, graphemeIndex: hit.graphemeIndex });
		},
		[codeKey],
	);

	const mainWidthPx = `${Math.round(mainRatio * 100)}%`;
	const sideWidthPx = `${Math.round((1 - mainRatio) * 100)}%`;

	return (
		<div className="demo-shell">
			{/* Main pane */}
			<div className="pane-main" style={{ width: mainWidthPx, maxWidth: mainWidthPx }}>
				<div className="section-title">Counters — pick a library</div>
				<div className="counter-grid">
					<RawCard
						selected={selectedLib === "graphrefly"}
						onSelect={() => handleSelect("graphrefly")}
					/>
					<JotaiCard selected={selectedLib === "jotai"} onSelect={() => handleSelect("jotai")} />
					<NanoCard
						selected={selectedLib === "nanostores"}
						onSelect={() => handleSelect("nanostores")}
					/>
					<ZustandCard
						selected={selectedLib === "zustand"}
						onSelect={() => handleSelect("zustand")}
					/>
				</div>
				<Leaderboard selected={selectedLib} onSelect={handleSelect} />
			</div>

			{/* Drag divider */}
			<div className="pane-divider" onMouseDown={onDividerMouseDown} title="Drag to resize" />

			{/* Side pane */}
			<div className="pane-side" ref={sidePaneRef} style={{ width: sideWidthPx }}>
				<div className="pane-graph" style={{ height: `${graphRatio * 100}%` }}>
					<h3>Graph topology — mermaid</h3>
					<MermaidGraph text={mermaidText} />
				</div>
				<div className="pane-split-divider" onMouseDown={onSplitMouseDown} title="Drag to resize" />
				<div className="pane-code">
					<h3>
						{codeTitle}
						{codeLayout.lineCount > 0 && (
							<span className="layout-meta" title="Reactive layout/code-lines from demo-shell">
								· {codeLayout.lineCount} lines · {codeLayout.maxWidth}px wide
								{leaderboardH > 0 ? ` · board ${leaderboardH}px` : null}
							</span>
						)}
					</h3>
					{codeSnippet && (
						<pre
							className="code-pre"
							onClick={onCodePaneClick}
							title="Click a character to hit-test via computeCharPositions"
						>
							{codeSnippet}
						</pre>
					)}
					{codeHit && (
						<div className="code-hit">
							Clicked line {codeHit.line + 1}, grapheme #{codeHit.graphemeIndex}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/** @jsxImportSource solid-js */

import type { ReadableAtom, WritableAtom } from "@graphrefly/graphrefly/compat/jotai";
import type { NanoAtom, NanoComputed } from "@graphrefly/graphrefly/compat/nanostores";
import { useStore, useSubscribe, useSubscribeRecord } from "@graphrefly/graphrefly/compat/solid";
import type { StoreApi } from "@graphrefly/graphrefly/compat/zustand";
import type { Node } from "@graphrefly/graphrefly/core";
import type { DemoShellHandle } from "@graphrefly/graphrefly/patterns/demo-shell";
import { demoShell } from "@graphrefly/graphrefly/patterns/demo-shell";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
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

type LibName = "graphrefly" | "jotai" | "nanostores" | "zustand";
type Selection = LibName | "leaderboard" | null;

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

// ── Custom bridging hooks ─────────────────────────────────────────────

function useJotaiAtom<T>(atom: WritableAtom<T>) {
	const [value, setValue] = createSignal<T>(atom.get(), { equals: false });
	const unsub = atom.subscribe((v: T) => setValue(() => v));
	onCleanup(() => unsub());
	return {
		get: value,
		set: (v: T) => atom.set(v),
	};
}

function useJotaiReadonly<T>(atom: ReadableAtom<T>) {
	const [value, setValue] = createSignal<T>(atom.get(), { equals: false });
	const unsub = atom.subscribe((v: T) => setValue(() => v));
	onCleanup(() => unsub());
	return value;
}

function useNanoAtom<T>(store: NanoAtom<T>) {
	const [value, setValue] = createSignal<T>(store.get(), { equals: false });
	const unsub = store.subscribe((v: T) => setValue(() => v));
	onCleanup(() => unsub());
	return {
		get: value,
		set: (v: T) => store.set(v),
	};
}

function useNanoComputedValue<T>(store: NanoComputed<T>) {
	const [value, setValue] = createSignal<T>(store.get(), { equals: false });
	const unsub = store.subscribe((v: T) => setValue(() => v));
	onCleanup(() => unsub());
	return value;
}

function useZustandAtom<T extends object>(store: StoreApi<T>) {
	const [value, setValue] = createSignal<T>(store.getState(), { equals: false });
	const unsub = store.subscribe((s: T) => setValue(() => s));
	onCleanup(() => unsub());
	return value;
}

function useZustandSelector<T extends object, R>(store: StoreApi<T>, selector: (s: T) => R) {
	const [value, setValue] = createSignal<R>(selector(store.getState()), { equals: false });
	const unsub = store.subscribe((s: T) => setValue(() => selector(s)));
	onCleanup(() => unsub());
	return value;
}

// ── Main component ────────────────────────────────────────────────────

const codeSnippets = getCodeSnippets("solid");

export default function SolidDemo() {
	// Shell
	let shellHandle: DemoShellHandle | null = null;
	let graphEl: HTMLDivElement | undefined;
	let sidePaneEl: HTMLDivElement | undefined;
	const [mermaidText, setMermaidText] = createSignal("");
	const [selectedLib, setSelectedLib] = createSignal<Selection>(null);
	const [mainRatio, setMainRatioState] = createSignal(0.6);
	const [graphRatio, setGraphRatio] = createSignal(0.5);
	const [isDragging, setDragging] = createSignal(false);
	const [isDraggingSplit, setDraggingSplit] = createSignal(false);
	const [codeLayout, setCodeLayout] = createSignal<CodeLayoutSummary>({
		lineCount: 0,
		maxWidth: 0,
	});
	const [leaderboardH, setLeaderboardH] = createSignal(0);
	const [codeHit, setCodeHit] = createSignal<{ line: number; graphemeIndex: number } | null>(null);

	// GraphReFly raw — useStore returns [Accessor, setter]
	const [rawValue, setRawValue] = useStore(rawNode as Node<number>);
	const rawCount = createMemo(() => (rawValue() as number) ?? 0);
	const rawDoubled = useSubscribe(rawDoubledNode as Node<number>);
	const rawDoubledVal = createMemo(() => (rawDoubled() as number) ?? 0);

	// Jotai
	const jotai = useJotaiAtom(jotaiCounter);
	const jotaiVal = createMemo(() => (jotai.get() as number) ?? 0);
	const jotaiDoubledVal = useJotaiReadonly(jotaiDoubled);
	const jotaiDoubledDisplay = createMemo(() => (jotaiDoubledVal() as number) ?? 0);

	// Nanostores
	const nano = useNanoAtom(nanoCounter);
	const nanoVal = createMemo(() => (nano.get() as number) ?? 0);
	const nanoDoubledVal = useNanoComputedValue(nanoDoubled);
	const nanoDoubledDisplay = createMemo(() => (nanoDoubledVal() as number) ?? 0);

	// Zustand
	const zustandState = useZustandAtom(zustandStore);
	const zustandVal = createMemo(() => (zustandState() as { count: number } | null)?.count ?? 0);
	const zustandDoubledVal = useZustandSelector(zustandStore, zustandDoubledSelector);
	const zustandDoubledDisplay = createMemo(() => (zustandDoubledVal() as number) ?? 0);

	// Read-only subscriptions
	const total = useSubscribe(totalNode as Node<number>);
	const totalVal = createMemo(() => (total() as number) ?? 0);

	const record = useSubscribeRecord(
		keysNode as Node<string[]>,
		counterNodeFactory as (key: string) => { count: Node<number> },
	);

	const currentSnippet = createMemo(() => {
		const s = selectedLib();
		return s ? codeSnippets[s] : null;
	});
	const currentTitle = createMemo(() => {
		const s = selectedLib();
		if (!s) return "Select a card to see code";
		if (s === "leaderboard") return "Leaderboard — useSubscribeRecord code";
		return `${LIB_LABELS[s]} — binding code`;
	});

	const mainWidthPct = createMemo(() => `${Math.round(mainRatio() * 100)}%`);
	const sideWidthPct = createMemo(() => `${Math.round((1 - mainRatio()) * 100)}%`);

	// Shell lifecycle
	onMount(() => {
		initMermaid();
		if (graphEl) {
			const cleanup = attachPanZoom(graphEl);
			onCleanup(cleanup);
		}
		const s = demoShell({
			mainRatio: mainRatio(),
			viewportWidth: window.innerWidth,
			adapter: getMeasurementAdapter(),
			layoutFont: LAYOUT_FONT,
		});
		shellHandle = s;
		s.setDemoGraph(counterGraph);
		s.bumpGraphTick();

		const mermaidNode = s.graph.resolve("graph/mermaid");
		const unsub = mermaidNode.subscribe(() => {
			setMermaidText((mermaidNode.cache as string) ?? "");
		});
		setMermaidText((mermaidNode.cache as string) ?? "");

		const graphRatioNode = s.graph.resolve("pane/graph-height-ratio");
		const unsubGraphRatio = graphRatioNode.subscribe(() => {
			setGraphRatio((graphRatioNode.cache as number) ?? 0.5);
		});
		setGraphRatio((graphRatioNode.cache as number) ?? 0.5);

		const codeLinesNode = s.graph.resolve("layout/code-lines");
		const unsubCodeLines = codeLinesNode.subscribe(() => {
			setCodeLayout(
				summarizeCodeLines(codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0]),
			);
		});
		setCodeLayout(
			summarizeCodeLines(codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0]),
		);

		const unsubLeaderboardH = leaderboardTotalHeight.subscribe(() => {
			setLeaderboardH((leaderboardTotalHeight.cache as number) ?? 0);
		});
		setLeaderboardH((leaderboardTotalHeight.cache as number) ?? 0);

		const onResize = () => s.setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);

		onCleanup(() => {
			unsub();
			unsubGraphRatio();
			unsubCodeLines();
			unsubLeaderboardH();
			window.removeEventListener("resize", onResize);
			s.destroy();
		});
	});

	// Mermaid rendering via Solid's createEffect
	createEffect(() => {
		const text = mermaidText();
		const el = graphEl;
		if (!el) return;
		if (!text) {
			el.innerHTML = "";
			return;
		}
		let cancelled = false;
		mermaid
			.render(nextMermaidId(), text)
			.then(({ svg, bindFunctions }) => {
				if (cancelled || !graphEl) return;
				graphEl.innerHTML = svg;
				bindFunctions?.(graphEl);
			})
			.catch((err) => {
				if (cancelled || !graphEl) return;
				console.warn("[SolidDemo mermaid] render failed:", err);
				graphEl.textContent = text;
			});
		onCleanup(() => {
			cancelled = true;
		});
	});

	// Drag divider
	function onDividerMouseDown(e: MouseEvent) {
		e.preventDefault();
		setDragging(true);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		const onMove = (ev: MouseEvent) => {
			const ratio = Math.max(0.2, Math.min(0.85, ev.clientX / window.innerWidth));
			setMainRatioState(ratio);
			shellHandle?.setMainRatio(ratio);
		};
		const onUp = () => {
			setDragging(false);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}

	function onSplitMouseDown(e: MouseEvent) {
		e.preventDefault();
		setDraggingSplit(true);
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";

		const onMove = (ev: MouseEvent) => {
			if (!sidePaneEl) return;
			const rect = sidePaneEl.getBoundingClientRect();
			const ratio = Math.max(0.1, Math.min(0.9, (ev.clientY - rect.top) / rect.height));
			shellHandle?.setSideSplit(ratio);
		};
		const onUp = () => {
			setDraggingSplit(false);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}

	function selectLib(lib: Selection) {
		setSelectedLib(lib);
		setCodeHit(null);
		const snippet = lib ? codeSnippets[lib] : "";
		shellHandle?.setCodeText(snippet ?? "");
		if (lib === "leaderboard") {
			shellHandle?.selectNode("counter-keys");
			return;
		}
		if (lib === null) return;
		const nodeMap: Record<LibName, string> = {
			graphrefly: "graphrefly/count",
			jotai: "jotai/count",
			nanostores: "nanostores/count",
			zustand: "zustand/count",
		};
		shellHandle?.selectNode(nodeMap[lib]);
	}

	function onCodePaneClick(e: MouseEvent) {
		const lib = selectedLib();
		if (!lib) return;
		const snippet = codeSnippets[lib];
		if (!snippet) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const padding = 16;
		const hit = hitTestCharacter(
			snippet,
			Math.max(100, rect.width - padding * 2),
			e.clientX - rect.left - padding,
			e.clientY - rect.top - padding,
		);
		if (hit) setCodeHit({ line: hit.line, graphemeIndex: hit.graphemeIndex });
	}

	const libs = ["graphrefly", "jotai", "nanostores", "zustand"] as LibName[];

	return (
		<div class="demo-shell">
			{/* Main pane */}
			<div class="pane-main" style={{ width: mainWidthPct(), "max-width": mainWidthPct() }}>
				<div class="section-title">Counters — pick a library</div>
				<div class="counter-grid">
					{/* GraphReFly raw */}
					<div
						class={`counter-card${selectedLib() === "graphrefly" ? " selected" : ""}`}
						data-lib="graphrefly"
						onClick={() => selectLib("graphrefly")}
					>
						<span class="lib-badge">GraphReFly</span>
						<div class="counter-display">
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									setRawValue(rawCount() - 1);
								}}
							>
								−
							</button>
							<span class="counter-value">{rawCount()}</span>
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									setRawValue(rawCount() + 1);
								}}
							>
								+
							</button>
						</div>
						<p class="counter-desc">{LIB_DESCS.graphrefly}</p>
						<p class="counter-derived">
							<span class="derived-label">derived()</span>
							<span class="derived-value">doubled = {rawDoubledVal()}</span>
						</p>
					</div>

					{/* Jotai */}
					<div
						class={`counter-card${selectedLib() === "jotai" ? " selected" : ""}`}
						data-lib="jotai"
						onClick={() => selectLib("jotai")}
					>
						<span class="lib-badge">Jotai</span>
						<div class="counter-display">
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									jotai.set(jotaiVal() - 1);
								}}
							>
								−
							</button>
							<span class="counter-value">{jotaiVal()}</span>
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									jotai.set(jotaiVal() + 1);
								}}
							>
								+
							</button>
						</div>
						<p class="counter-desc">{LIB_DESCS.jotai}</p>
						<p class="counter-derived">
							<span class="derived-label">{"atom(get => ...)"}</span>
							<span class="derived-value">doubled = {jotaiDoubledDisplay()}</span>
						</p>
					</div>

					{/* Nanostores */}
					<div
						class={`counter-card${selectedLib() === "nanostores" ? " selected" : ""}`}
						data-lib="nanostores"
						onClick={() => selectLib("nanostores")}
					>
						<span class="lib-badge">Nanostores</span>
						<div class="counter-display">
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									nano.set(nanoVal() - 1);
								}}
							>
								−
							</button>
							<span class="counter-value">{nanoVal()}</span>
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									nano.set(nanoVal() + 1);
								}}
							>
								+
							</button>
						</div>
						<p class="counter-desc">{LIB_DESCS.nanostores}</p>
						<p class="counter-derived">
							<span class="derived-label">computed(atom, fn)</span>
							<span class="derived-value">doubled = {nanoDoubledDisplay()}</span>
						</p>
					</div>

					{/* Zustand */}
					<div
						class={`counter-card${selectedLib() === "zustand" ? " selected" : ""}`}
						data-lib="zustand"
						onClick={() => selectLib("zustand")}
					>
						<span class="lib-badge">Zustand</span>
						<div class="counter-display">
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									(zustandState() as any)?.dec?.();
								}}
							>
								−
							</button>
							<span class="counter-value">{zustandVal()}</span>
							<button
								class="counter-btn"
								onClick={(e) => {
									e.stopPropagation();
									(zustandState() as any)?.inc?.();
								}}
							>
								+
							</button>
						</div>
						<p class="counter-desc">{LIB_DESCS.zustand}</p>
						<p class="counter-derived">
							<span class="derived-label">selector(state)</span>
							<span class="derived-value">doubled = {zustandDoubledDisplay()}</span>
						</p>
					</div>
				</div>

				{/* Leaderboard */}
				<div
					class={`leaderboard${selectedLib() === "leaderboard" ? " selected" : ""}`}
					onClick={() => selectLib("leaderboard")}
				>
					<div class="leaderboard-title">Leaderboard — useSubscribeRecord</div>
					<div class="leaderboard-rows">
						{libs.map((lib) => (
							<button
								type="button"
								class={`leaderboard-row${selectedLib() === lib ? " selected" : ""}`}
								data-lib-row={lib}
								onClick={(e) => {
									e.stopPropagation();
									selectLib(lib);
								}}
							>
								<span class="leaderboard-key" data-lib={lib}>
									{LIB_LABELS[lib]}
								</span>
								<span class="leaderboard-val">{record()[lib]?.count ?? 0}</span>
							</button>
						))}
					</div>
					<div class="total-line">
						Total: <strong>{totalVal()}</strong>
					</div>
				</div>
			</div>

			{/* Drag divider */}
			<div
				class={`pane-divider${isDragging() ? " dragging" : ""}`}
				onMouseDown={onDividerMouseDown}
				title="Drag to resize"
			/>

			{/* Side pane */}
			<div class="pane-side" ref={sidePaneEl} style={{ width: sideWidthPct() }}>
				<div class="pane-graph" style={{ height: `${graphRatio() * 100}%` }}>
					<h3>Graph topology — mermaid</h3>
					<div ref={graphEl} class="mermaid-graph" />
				</div>
				<div
					class={`pane-split-divider${isDraggingSplit() ? " dragging" : ""}`}
					onMouseDown={onSplitMouseDown}
					title="Drag to resize"
				/>
				<div class="pane-code">
					<h3>
						{currentTitle()}
						{codeLayout().lineCount > 0 && (
							<span class="layout-meta" title="Reactive layout/code-lines from demo-shell">
								{` · ${codeLayout().lineCount} lines · ${codeLayout().maxWidth}px wide`}
								{leaderboardH() > 0 ? ` · board ${leaderboardH()}px` : ""}
							</span>
						)}
					</h3>
					{currentSnippet() && (
						<pre
							class="code-pre"
							onClick={onCodePaneClick}
							title="Click a character to hit-test via computeCharPositions"
						>
							{currentSnippet()}
						</pre>
					)}
					{codeHit() && (
						<div class="code-hit">
							Clicked line {codeHit()!.line + 1}, grapheme #{codeHit()!.graphemeIndex}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

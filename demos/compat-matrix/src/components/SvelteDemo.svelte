<script lang="ts">
import type { Node } from "@graphrefly/graphrefly";
import { useStore, useSubscribe, useSubscribeRecord } from "@graphrefly/graphrefly/compat/svelte";
import type { DemoShellHandle } from "@graphrefly/graphrefly/patterns/demo-shell";
import { demoShell } from "@graphrefly/graphrefly/patterns/demo-shell";
import { onMount } from "svelte";
import { readable, writable } from "svelte/store";
import {
	getCodeSnippets,
	counterGraph,
	counterNodeFactory,
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

const libs: LibName[] = ["graphrefly", "jotai", "nanostores", "zustand"];
const codeSnippets = getCodeSnippets("svelte");

// ── Reactive state (Svelte 5 runes) ──────────────────────────────
let shellHandle: DemoShellHandle | null = $state(null);
let mermaidText = $state("");
let selectedLib: Selection = $state(null);
let mainRatio = $state(0.6);
let graphRatio = $state(0.5);
let dragging = $state(false);
let draggingSplit = $state(false);
let graphEl: HTMLDivElement | null = $state(null);
let sidePaneEl: HTMLDivElement | null = $state(null);
let codeLayout: CodeLayoutSummary = $state({ lineCount: 0, maxWidth: 0 });
let leaderboardH = $state(0);
let codeHit: { line: number; graphemeIndex: number } | null = $state(null);

// ── Derived layout values ────────────────────────────────────────
let mainWidthPct = $derived(`${Math.round(mainRatio * 100)}%`);
let sideWidthPct = $derived(`${Math.round((1 - mainRatio) * 100)}%`);
let currentSnippet = $derived(selectedLib ? codeSnippets[selectedLib] : null);
let currentTitle = $derived(
	selectedLib === null
		? "Select a card to see code"
		: selectedLib === "leaderboard"
			? "Leaderboard — useSubscribeRecord code"
			: `${LIB_LABELS[selectedLib]} — binding code`,
);

// ── GraphReFly raw — Svelte writable store ───────────────────────
const rawStore = useStore(rawNode as Node<number>);
const rawDoubledStore = useSubscribe(rawDoubledNode as Node<number>);

// ── Jotai — bridge to Svelte writable ────────────────────────────
const jotaiStore = writable<number>(jotaiCounter.get() ?? 0);
const jotaiUnsub = jotaiCounter.subscribe((v: number) => jotaiStore.set(v));
const jotaiDoubledStore = writable<number>(jotaiDoubled.get() ?? 0);
const jotaiDoubledUnsub = jotaiDoubled.subscribe((v: number) => jotaiDoubledStore.set(v));

// ── Nanostores — bridge to Svelte writable ───────────────────────
const nanoStore = writable<number>(nanoCounter.get());
const nanoUnsub = nanoCounter.subscribe((v: number) => nanoStore.set(v));
const nanoDoubledStore = writable<number>(nanoDoubled.get() ?? 0);
const nanoDoubledUnsub = nanoDoubled.subscribe((v: number) => nanoDoubledStore.set(v));

// ── Zustand — bridge to Svelte readable ──────────────────────────
type ZustandState = { count: number; inc: () => void; dec: () => void };
const zustandSvelteStore = readable<ZustandState>(zustandStore.getState() as ZustandState, (set) =>
	zustandStore.subscribe((state) => set(state as ZustandState)),
);
// Zustand selector-derived value — bridges store.subscribe + selector into a readable
const zustandDoubledSvelteStore = readable<number>(
	zustandDoubledSelector(zustandStore.getState() as ZustandState),
	(set) =>
		zustandStore.subscribe((state) => set(zustandDoubledSelector(state as ZustandState))),
);

// ── Total & leaderboard ──────────────────────────────────────────
const totalStore = useSubscribe(totalNode as Node<number>);
const recordStore = useSubscribeRecord(
	keysNode as Node<string[]>,
	counterNodeFactory as (key: string) => { count: Node<number> },
);

// ── Derived store values (for template) ──────────────────────────
let rawVal = $derived(($rawStore as number) ?? 0);
let rawDoubledVal = $derived(($rawDoubledStore as number) ?? 0);
let jotaiVal = $derived($jotaiStore ?? 0);
let jotaiDoubledVal = $derived($jotaiDoubledStore ?? 0);
let nanoVal = $derived($nanoStore ?? 0);
let nanoDoubledVal = $derived($nanoDoubledStore ?? 0);
let zustandVal = $derived(($zustandSvelteStore as ZustandState | null)?.count ?? 0);
let zustandDoubledVal = $derived($zustandDoubledSvelteStore ?? 0);
let totalVal = $derived(($totalStore as number) ?? 0);

// ── Shell lifecycle ──────────────────────────────────────────────
let mermaidNodeUnsub: (() => void) | null = null;
let graphRatioUnsub: (() => void) | null = null;
let codeLinesUnsub: (() => void) | null = null;
let leaderboardUnsub: (() => void) | null = null;
let onResizeHandler: (() => void) | null = null;
let panZoomCleanup: (() => void) | null = null;

onMount(() => {
	initMermaid();
	if (graphEl) panZoomCleanup = attachPanZoom(graphEl);
	const s = demoShell({
		mainRatio,
		viewportWidth: window.innerWidth,
		adapter: getMeasurementAdapter(),
		layoutFont: LAYOUT_FONT,
	});
	shellHandle = s;
	s.setDemoGraph(counterGraph);
	s.bumpGraphTick();

	const mermaidNode = s.graph.resolve("graph/mermaid");
	mermaidNodeUnsub = mermaidNode.subscribe(() => {
		mermaidText = (mermaidNode.cache as string) ?? "";
	});
	mermaidText = (mermaidNode.cache as string) ?? "";

	const graphRatioNode = s.graph.resolve("pane/graph-height-ratio");
	graphRatioUnsub = graphRatioNode.subscribe(() => {
		graphRatio = (graphRatioNode.cache as number) ?? 0.5;
	});
	graphRatio = (graphRatioNode.cache as number) ?? 0.5;

	const codeLinesNode = s.graph.resolve("layout/code-lines");
	codeLinesUnsub = codeLinesNode.subscribe(() => {
		codeLayout = summarizeCodeLines(
			codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0],
		);
	});
	codeLayout = summarizeCodeLines(
		codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0],
	);

	leaderboardUnsub = leaderboardTotalHeight.subscribe(() => {
		leaderboardH = (leaderboardTotalHeight.cache as number) ?? 0;
	});
	leaderboardH = (leaderboardTotalHeight.cache as number) ?? 0;

	onResizeHandler = () => s.setViewportWidth(window.innerWidth);
	window.addEventListener("resize", onResizeHandler);

	return () => {
		jotaiUnsub();
		jotaiDoubledUnsub();
		nanoUnsub();
		nanoDoubledUnsub();
		mermaidNodeUnsub?.();
		graphRatioUnsub?.();
		codeLinesUnsub?.();
		leaderboardUnsub?.();
		panZoomCleanup?.();
		if (onResizeHandler) window.removeEventListener("resize", onResizeHandler);
		shellHandle?.destroy();
	};
});

// ── Mermaid rendering via Svelte $effect ─────────────────────────
$effect(() => {
	const text = mermaidText;
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
			console.warn("[SvelteDemo mermaid] render failed:", err);
			graphEl.textContent = text;
		});
	return () => {
		cancelled = true;
	};
});

// ── Drag divider ─────────────────────────────────────────────────
function onDividerMouseDown(e: MouseEvent) {
	e.preventDefault();
	dragging = true;
	document.body.style.cursor = "col-resize";
	document.body.style.userSelect = "none";

	const onMove = (ev: MouseEvent) => {
		mainRatio = Math.max(0.2, Math.min(0.85, ev.clientX / window.innerWidth));
		shellHandle?.setMainRatio(mainRatio);
	};
	const onUp = () => {
		dragging = false;
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
	draggingSplit = true;
	document.body.style.cursor = "row-resize";
	document.body.style.userSelect = "none";

	const onMove = (ev: MouseEvent) => {
		if (!sidePaneEl) return;
		const rect = sidePaneEl.getBoundingClientRect();
		const ratio = Math.max(0.1, Math.min(0.9, (ev.clientY - rect.top) / rect.height));
		shellHandle?.setSideSplit(ratio);
	};
	const onUp = () => {
		draggingSplit = false;
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		window.removeEventListener("mousemove", onMove);
		window.removeEventListener("mouseup", onUp);
	};
	window.addEventListener("mousemove", onMove);
	window.addEventListener("mouseup", onUp);
}

// ── Selection ────────────────────────────────────────────────────
function selectLib(lib: Selection) {
	selectedLib = lib;
	codeHit = null;
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
	if (!selectedLib) return;
	const snippet = codeSnippets[selectedLib];
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
	if (hit) codeHit = { line: hit.line, graphemeIndex: hit.graphemeIndex };
}

// ── Write-through helpers ────────────────────────────────────────
function setJotai(v: number) {
	jotaiCounter.set(v);
}
function setNano(v: number) {
	nanoCounter.set(v);
}
</script>

<div class="demo-shell">
  <!-- Main pane -->
  <div class="pane-main" style="width: {mainWidthPct}; max-width: {mainWidthPct}">
    <div class="section-title">Counters — pick a library</div>
    <div class="counter-grid">

      <!-- GraphReFly raw -->
      <div
        class="counter-card"
        class:selected={selectedLib === 'graphrefly'}
        data-lib="graphrefly"
        onclick={() => selectLib('graphrefly')}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && selectLib('graphrefly')}
      >
        <span class="lib-badge">GraphReFly</span>
        <div class="counter-display">
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); rawStore.set(rawVal - 1); }}>−</button>
          <span class="counter-value">{rawVal}</span>
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); rawStore.set(rawVal + 1); }}>+</button>
        </div>
        <p class="counter-desc">{LIB_DESCS.graphrefly}</p>
        <p class="counter-derived">
          <span class="derived-label">derived()</span>
          <span class="derived-value">doubled = {rawDoubledVal}</span>
        </p>
      </div>

      <!-- Jotai -->
      <div
        class="counter-card"
        class:selected={selectedLib === 'jotai'}
        data-lib="jotai"
        onclick={() => selectLib('jotai')}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && selectLib('jotai')}
      >
        <span class="lib-badge">Jotai</span>
        <div class="counter-display">
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); setJotai(jotaiVal - 1); }}>−</button>
          <span class="counter-value">{jotaiVal}</span>
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); setJotai(jotaiVal + 1); }}>+</button>
        </div>
        <p class="counter-desc">{LIB_DESCS.jotai}</p>
        <p class="counter-derived">
          <span class="derived-label">{'atom(get => ...)'}</span>
          <span class="derived-value">doubled = {jotaiDoubledVal}</span>
        </p>
      </div>

      <!-- Nanostores -->
      <div
        class="counter-card"
        class:selected={selectedLib === 'nanostores'}
        data-lib="nanostores"
        onclick={() => selectLib('nanostores')}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && selectLib('nanostores')}
      >
        <span class="lib-badge">Nanostores</span>
        <div class="counter-display">
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); setNano(nanoVal - 1); }}>−</button>
          <span class="counter-value">{nanoVal}</span>
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); setNano(nanoVal + 1); }}>+</button>
        </div>
        <p class="counter-desc">{LIB_DESCS.nanostores}</p>
        <p class="counter-derived">
          <span class="derived-label">computed(atom, fn)</span>
          <span class="derived-value">doubled = {nanoDoubledVal}</span>
        </p>
      </div>

      <!-- Zustand -->
      <div
        class="counter-card"
        class:selected={selectedLib === 'zustand'}
        data-lib="zustand"
        onclick={() => selectLib('zustand')}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && selectLib('zustand')}
      >
        <span class="lib-badge">Zustand</span>
        <div class="counter-display">
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); $zustandSvelteStore?.dec?.(); }}>−</button>
          <span class="counter-value">{zustandVal}</span>
          <button class="counter-btn" onclick={(e) => { e.stopPropagation(); $zustandSvelteStore?.inc?.(); }}>+</button>
        </div>
        <p class="counter-desc">{LIB_DESCS.zustand}</p>
        <p class="counter-derived">
          <span class="derived-label">selector(state)</span>
          <span class="derived-value">doubled = {zustandDoubledVal}</span>
        </p>
      </div>

    </div>

    <!-- Leaderboard -->
    <div
      class="leaderboard"
      class:selected={selectedLib === 'leaderboard'}
      onclick={() => selectLib('leaderboard')}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && selectLib('leaderboard')}
    >
      <div class="leaderboard-title">Leaderboard — useSubscribeRecord</div>
      <div class="leaderboard-rows">
        {#each libs as lib}
          <button
            type="button"
            class="leaderboard-row"
            class:selected={selectedLib === lib}
            data-lib-row={lib}
            onclick={(e) => { e.stopPropagation(); selectLib(lib); }}
          >
            <span class="leaderboard-key" data-lib={lib}>{LIB_LABELS[lib]}</span>
            <span class="leaderboard-val">{$recordStore[lib]?.count ?? 0}</span>
          </button>
        {/each}
      </div>
      <div class="total-line">Total: <strong>{totalVal}</strong></div>
    </div>
  </div>

  <!-- Drag divider -->
  <div
    class="pane-divider"
    class:dragging
    onmousedown={onDividerMouseDown}
    title="Drag to resize"
    role="separator"
    aria-label="Resize panes"
  ></div>

  <!-- Side pane -->
  <div class="pane-side" bind:this={sidePaneEl} style="width: {sideWidthPct}">
    <div class="pane-graph" style="height: {graphRatio * 100}%">
      <h3>Graph topology — mermaid</h3>
      <div bind:this={graphEl} class="mermaid-graph"></div>
    </div>
    <div
      class="pane-split-divider"
      class:dragging={draggingSplit}
      onmousedown={onSplitMouseDown}
      role="separator"
      aria-label="Resize graph/code split"
    ></div>
    <div class="pane-code">
      <h3>
        {currentTitle}
        {#if codeLayout.lineCount > 0}
          <span class="layout-meta" title="Reactive layout/code-lines from demo-shell">
            · {codeLayout.lineCount} lines · {codeLayout.maxWidth}px wide{#if leaderboardH > 0} · board {leaderboardH}px{/if}
          </span>
        {/if}
      </h3>
      {#if currentSnippet}
        <pre
          class="code-pre"
          onclick={onCodePaneClick}
          title="Click a character to hit-test via computeCharPositions"
        >{currentSnippet}</pre>
      {/if}
      {#if codeHit}
        <div class="code-hit">
          Clicked line {codeHit.line + 1}, grapheme #{codeHit.graphemeIndex}
        </div>
      {/if}
    </div>
  </div>
</div>

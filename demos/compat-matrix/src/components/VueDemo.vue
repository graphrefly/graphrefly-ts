<script setup lang="ts">
import type { Node } from "@graphrefly/graphrefly";
import type { WritableAtom } from "@graphrefly/graphrefly/compat/jotai";
import type { NanoAtom, NanoComputed } from "@graphrefly/graphrefly/compat/nanostores";
import { useStore, useSubscribe, useSubscribeRecord } from "@graphrefly/graphrefly/compat/vue";
import type { StoreApi } from "@graphrefly/graphrefly/compat/zustand";
import type { DemoShellHandle } from "@graphrefly/graphrefly/patterns/demo-shell";
import { demoShell } from "@graphrefly/graphrefly/patterns/demo-shell";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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

const codeSnippets = getCodeSnippets("vue");

// ── Shell ─────────────────────────────────────────────────────────────
const shell = ref<DemoShellHandle | null>(null);
const mermaidText = ref("");
const selectedLib = ref<Selection>(null);
const mainRatio = ref(0.6);
const graphRatio = ref(0.5);
const dragging = ref(false);
const draggingSplit = ref(false);
const sidePaneEl = ref<HTMLDivElement | null>(null);
const codeLayout = ref<CodeLayoutSummary>({ lineCount: 0, maxWidth: 0 });
const leaderboardH = ref(0);
const codeHit = ref<{ line: number; graphemeIndex: number } | null>(null);

// ── GraphReFly raw binding ────────────────────────────────────────────
const rawCount = useStore(rawNode as Node<number>);
const rawDoubled = useSubscribe(rawDoubledNode as Node<number>);

// ── Jotai atom bridging ───────────────────────────────────────────────
function useJotaiAtom<T>(atom: WritableAtom<T>) {
	const value = ref<T>(atom.get()) as ReturnType<typeof ref<T>>;
	const unsub = atom.subscribe((v: T) => {
		value.value = v;
	});
	onUnmounted(() => unsub());
	return {
		value: computed(() => value.value),
		set: (v: T) => atom.set(v),
	};
}
function useJotaiReadonly<T>(atom: { get(): T; subscribe(cb: (v: T) => void): () => void }) {
	const value = ref<T>(atom.get()) as ReturnType<typeof ref<T>>;
	const unsub = atom.subscribe((v: T) => {
		value.value = v;
	});
	onUnmounted(() => unsub());
	return computed(() => value.value);
}
const jotai = useJotaiAtom(jotaiCounter);
const jotaiDoubledVal = useJotaiReadonly(jotaiDoubled);

// ── Nanostores atom bridging ──────────────────────────────────────────
function useNanoAtom<T>(store: NanoAtom<T>) {
	const value = ref<T>(store.get()) as ReturnType<typeof ref<T>>;
	const unsub = store.subscribe((v: T) => {
		value.value = v;
	});
	onUnmounted(() => unsub());
	return {
		value: computed(() => value.value),
		set: (v: T) => store.set(v),
	};
}
function useNanoComputedValue<T>(store: NanoComputed<T>) {
	const value = ref<T>(store.get()) as ReturnType<typeof ref<T>>;
	const unsub = store.subscribe((v: T) => {
		value.value = v;
	});
	onUnmounted(() => unsub());
	return computed(() => value.value);
}
const nano = useNanoAtom(nanoCounter);
const nanoDoubledVal = useNanoComputedValue(nanoDoubled);

// ── Zustand store bridging ────────────────────────────────────────────
function useZustandStore<T extends object>(store: StoreApi<T>) {
	const value = ref<T>(store.getState()) as ReturnType<typeof ref<T>>;
	const unsub = store.subscribe((state: T) => {
		value.value = state;
	});
	onUnmounted(() => unsub());
	return computed(() => value.value);
}
function useZustandSelector<T extends object, R>(store: StoreApi<T>, selector: (s: T) => R) {
	const value = ref<R>(selector(store.getState())) as ReturnType<typeof ref<R>>;
	const unsub = store.subscribe((state: T) => {
		value.value = selector(state);
	});
	onUnmounted(() => unsub());
	return computed(() => value.value);
}
const zustand = useZustandStore(zustandStore);
const zustandDoubledVal = useZustandSelector(zustandStore, zustandDoubledSelector);

// ── Read-only subscriptions ───────────────────────────────────────────
const total = useSubscribe(totalNode as Node<number>);

const keysRef = useSubscribe(keysNode as Node<string[]>);
const record = useSubscribeRecord(
	keysRef,
	counterNodeFactory as (key: string) => { count: Node<number> },
);

// ── Computed helpers ──────────────────────────────────────────────────
const rawVal = computed(() => (rawCount.value as number) ?? 0);
const rawDoubledDisplay = computed(() => (rawDoubled.value as number) ?? 0);
const jotaiVal = computed(() => (jotai.value.value as number) ?? 0);
const jotaiDoubledDisplay = computed(() => (jotaiDoubledVal.value as number) ?? 0);
const nanoVal = computed(() => (nano.value.value as number) ?? 0);
const nanoDoubledDisplay = computed(() => (nanoDoubledVal.value as number) ?? 0);
const zustandVal = computed(() => (zustand.value as { count: number } | null)?.count ?? 0);
const zustandDoubledDisplay = computed(() => (zustandDoubledVal.value as number) ?? 0);
const totalVal = computed(() => (total.value as number) ?? 0);

const currentSnippet = computed(() => (selectedLib.value ? codeSnippets[selectedLib.value] : null));
const currentTitle = computed(() => {
	if (!selectedLib.value) return "Select a card to see code";
	if (selectedLib.value === "leaderboard") return "Leaderboard — useSubscribeRecord code";
	return `${LIB_LABELS[selectedLib.value]} — binding code`;
});

const mainWidthPct = computed(() => `${Math.round(mainRatio.value * 100)}%`);
const sideWidthPct = computed(() => `${Math.round((1 - mainRatio.value) * 100)}%`);

// ── Mermaid graph rendering ──────────────────────────────────────────
const graphEl = ref<HTMLDivElement | null>(null);
let panZoomCleanup: (() => void) | null = null;

onMounted(() => {
	initMermaid();
	if (graphEl.value) panZoomCleanup = attachPanZoom(graphEl.value);
});
onUnmounted(() => {
	panZoomCleanup?.();
});

watch(
	[mermaidText, graphEl],
	async ([text, el]) => {
		if (!el) return;
		if (!text) {
			el.innerHTML = "";
			return;
		}
		try {
			const { svg, bindFunctions } = await mermaid.render(nextMermaidId(), text);
			if (!graphEl.value) return;
			graphEl.value.innerHTML = svg;
			bindFunctions?.(graphEl.value);
		} catch (err) {
			console.warn("[VueDemo mermaid] render failed:", err);
			if (graphEl.value) graphEl.value.textContent = text;
		}
	},
	{ immediate: true },
);

// ── Shell lifecycle ───────────────────────────────────────────────────
let mermaidUnsub: (() => void) | null = null;
let graphRatioUnsub: (() => void) | null = null;
let codeLinesUnsub: (() => void) | null = null;
let leaderboardUnsub: (() => void) | null = null;
let onResizeHandler: (() => void) | null = null;

onMounted(() => {
	const s = demoShell({
		mainRatio: mainRatio.value,
		viewportWidth: window.innerWidth,
		adapter: getMeasurementAdapter(),
		layoutFont: LAYOUT_FONT,
	});
	shell.value = s;
	s.setDemoGraph(counterGraph);
	s.bumpGraphTick();

	const mermaidNode = s.graph.resolve("graph/mermaid");
	mermaidUnsub = mermaidNode.subscribe(() => {
		mermaidText.value = (mermaidNode.cache as string) ?? "";
	});
	mermaidText.value = (mermaidNode.cache as string) ?? "";

	const graphRatioNode = s.graph.resolve("pane/graph-height-ratio");
	graphRatioUnsub = graphRatioNode.subscribe(() => {
		graphRatio.value = (graphRatioNode.cache as number) ?? 0.5;
	});
	graphRatio.value = (graphRatioNode.cache as number) ?? 0.5;

	const codeLinesNode = s.graph.resolve("layout/code-lines");
	codeLinesUnsub = codeLinesNode.subscribe(() => {
		codeLayout.value = summarizeCodeLines(
			codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0],
		);
	});
	codeLayout.value = summarizeCodeLines(
		codeLinesNode.cache as Parameters<typeof summarizeCodeLines>[0],
	);

	leaderboardUnsub = leaderboardTotalHeight.subscribe(() => {
		leaderboardH.value = (leaderboardTotalHeight.cache as number) ?? 0;
	});
	leaderboardH.value = (leaderboardTotalHeight.cache as number) ?? 0;

	onResizeHandler = () => s.setViewportWidth(window.innerWidth);
	window.addEventListener("resize", onResizeHandler);
});

onUnmounted(() => {
	mermaidUnsub?.();
	graphRatioUnsub?.();
	codeLinesUnsub?.();
	leaderboardUnsub?.();
	if (onResizeHandler) window.removeEventListener("resize", onResizeHandler);
	shell.value?.destroy();
});

// ── Drag divider ──────────────────────────────────────────────────────
function onDividerMouseDown(e: MouseEvent) {
	e.preventDefault();
	dragging.value = true;
	document.body.style.cursor = "col-resize";
	document.body.style.userSelect = "none";

	const onMove = (ev: MouseEvent) => {
		if (!dragging.value) return;
		const ratio = Math.max(0.2, Math.min(0.85, ev.clientX / window.innerWidth));
		mainRatio.value = ratio;
		shell.value?.setMainRatio(ratio);
	};
	const onUp = () => {
		dragging.value = false;
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
	draggingSplit.value = true;
	document.body.style.cursor = "row-resize";
	document.body.style.userSelect = "none";

	const onMove = (ev: MouseEvent) => {
		if (!draggingSplit.value || !sidePaneEl.value) return;
		const rect = sidePaneEl.value.getBoundingClientRect();
		const ratio = Math.max(0.1, Math.min(0.9, (ev.clientY - rect.top) / rect.height));
		shell.value?.setSideSplit(ratio);
	};
	const onUp = () => {
		draggingSplit.value = false;
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		window.removeEventListener("mousemove", onMove);
		window.removeEventListener("mouseup", onUp);
	};
	window.addEventListener("mousemove", onMove);
	window.addEventListener("mouseup", onUp);
}

// ── Selection ────────────────────────────────────────────────────────
function selectLib(lib: Selection) {
	selectedLib.value = lib;
	codeHit.value = null;
	const snippet = lib ? codeSnippets[lib] : "";
	shell.value?.setCodeText(snippet ?? "");
	if (lib === "leaderboard") {
		shell.value?.selectNode("counter-keys");
		return;
	}
	if (lib === null) return;
	const nodeMap: Record<LibName, string> = {
		graphrefly: "graphrefly/count",
		jotai: "jotai/count",
		nanostores: "nanostores/count",
		zustand: "zustand/count",
	};
	shell.value?.selectNode(nodeMap[lib]);
}

function onCodePaneClick(e: MouseEvent) {
	if (!selectedLib.value) return;
	const snippet = codeSnippets[selectedLib.value];
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
	if (hit) codeHit.value = { line: hit.line, graphemeIndex: hit.graphemeIndex };
}
</script>

<template>
  <div class="demo-shell">
    <!-- Main pane -->
    <div class="pane-main" :style="{ width: mainWidthPct, maxWidth: mainWidthPct }">
      <div class="section-title">Counters — pick a library</div>
      <div class="counter-grid">

        <!-- GraphReFly raw -->
        <div
          class="counter-card"
          :class="{ selected: selectedLib === 'graphrefly' }"
          data-lib="graphrefly"
          @click="selectLib('graphrefly')"
        >
          <span class="lib-badge">GraphReFly</span>
          <div class="counter-display">
            <button class="counter-btn" @click.stop="rawCount = rawVal - 1">−</button>
            <span class="counter-value">{{ rawVal }}</span>
            <button class="counter-btn" @click.stop="rawCount = rawVal + 1">+</button>
          </div>
          <p class="counter-desc">{{ LIB_DESCS.graphrefly }}</p>
          <p class="counter-derived">
            <span class="derived-label">derived()</span>
            <span class="derived-value">doubled = {{ rawDoubledDisplay }}</span>
          </p>
        </div>

        <!-- Jotai -->
        <div
          class="counter-card"
          :class="{ selected: selectedLib === 'jotai' }"
          data-lib="jotai"
          @click="selectLib('jotai')"
        >
          <span class="lib-badge">Jotai</span>
          <div class="counter-display">
            <button class="counter-btn" @click.stop="jotai.set(jotaiVal - 1)">−</button>
            <span class="counter-value">{{ jotaiVal }}</span>
            <button class="counter-btn" @click.stop="jotai.set(jotaiVal + 1)">+</button>
          </div>
          <p class="counter-desc">{{ LIB_DESCS.jotai }}</p>
          <p class="counter-derived">
            <span class="derived-label">atom(get =&gt; ...)</span>
            <span class="derived-value">doubled = {{ jotaiDoubledDisplay }}</span>
          </p>
        </div>

        <!-- Nanostores -->
        <div
          class="counter-card"
          :class="{ selected: selectedLib === 'nanostores' }"
          data-lib="nanostores"
          @click="selectLib('nanostores')"
        >
          <span class="lib-badge">Nanostores</span>
          <div class="counter-display">
            <button class="counter-btn" @click.stop="nano.set(nanoVal - 1)">−</button>
            <span class="counter-value">{{ nanoVal }}</span>
            <button class="counter-btn" @click.stop="nano.set(nanoVal + 1)">+</button>
          </div>
          <p class="counter-desc">{{ LIB_DESCS.nanostores }}</p>
          <p class="counter-derived">
            <span class="derived-label">computed(atom, fn)</span>
            <span class="derived-value">doubled = {{ nanoDoubledDisplay }}</span>
          </p>
        </div>

        <!-- Zustand -->
        <div
          class="counter-card"
          :class="{ selected: selectedLib === 'zustand' }"
          data-lib="zustand"
          @click="selectLib('zustand')"
        >
          <span class="lib-badge">Zustand</span>
          <div class="counter-display">
            <button class="counter-btn" @click.stop="zustand?.dec?.()">−</button>
            <span class="counter-value">{{ zustandVal }}</span>
            <button class="counter-btn" @click.stop="zustand?.inc?.()">+</button>
          </div>
          <p class="counter-desc">{{ LIB_DESCS.zustand }}</p>
          <p class="counter-derived">
            <span class="derived-label">selector(state)</span>
            <span class="derived-value">doubled = {{ zustandDoubledDisplay }}</span>
          </p>
        </div>

      </div>

      <!-- Leaderboard -->
      <div
        class="leaderboard"
        :class="{ selected: selectedLib === 'leaderboard' }"
        @click="selectLib('leaderboard')"
      >
        <div class="leaderboard-title">Leaderboard — useSubscribeRecord</div>
        <div class="leaderboard-rows">
          <button
            v-for="lib in (['graphrefly', 'jotai', 'nanostores', 'zustand'] as LibName[])"
            :key="lib"
            type="button"
            class="leaderboard-row"
            :class="{ selected: selectedLib === lib }"
            :data-lib-row="lib"
            @click.stop="selectLib(lib)"
          >
            <span class="leaderboard-key" :data-lib="lib">{{ LIB_LABELS[lib] }}</span>
            <span class="leaderboard-val">{{ record[lib]?.count ?? 0 }}</span>
          </button>
        </div>
        <div class="total-line">Total: <strong>{{ totalVal }}</strong></div>
      </div>
    </div>

    <!-- Drag divider -->
    <div
      class="pane-divider"
      :class="{ dragging }"
      @mousedown="onDividerMouseDown"
      title="Drag to resize"
    />

    <!-- Side pane -->
    <div class="pane-side" ref="sidePaneEl" :style="{ width: sideWidthPct }">
      <div class="pane-graph" :style="{ height: `${graphRatio * 100}%` }">
        <h3>Graph topology — mermaid</h3>
        <div ref="graphEl" class="mermaid-graph" />
      </div>
      <div
        class="pane-split-divider"
        :class="{ dragging: draggingSplit }"
        @mousedown="onSplitMouseDown"
        title="Drag to resize"
      />
      <div class="pane-code">
        <h3>
          {{ currentTitle }}
          <span v-if="codeLayout.lineCount > 0" class="layout-meta" title="Reactive layout/code-lines from demo-shell">
            · {{ codeLayout.lineCount }} lines · {{ codeLayout.maxWidth }}px wide<template v-if="leaderboardH > 0"> · board {{ leaderboardH }}px</template>
          </span>
        </h3>
        <pre
          v-if="currentSnippet"
          class="code-pre"
          @click="onCodePaneClick"
          title="Click a character to hit-test via computeCharPositions"
        >{{ currentSnippet }}</pre>
        <div v-if="codeHit" class="code-hit">
          Clicked line {{ codeHit.line + 1 }}, grapheme #{{ codeHit.graphemeIndex }}
        </div>
      </div>
    </div>
  </div>
</template>

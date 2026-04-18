import type { Node } from "@graphrefly/graphrefly";
import { DATA, derived, state } from "@graphrefly/graphrefly";
import { atom as jotaiAtom } from "@graphrefly/graphrefly/compat/jotai";
import { atom as nanoAtom, computed as nanoComputed } from "@graphrefly/graphrefly/compat/nanostores";
import { create as zustandCreate } from "@graphrefly/graphrefly/compat/zustand";
import { Graph } from "@graphrefly/graphrefly/graph";
import { createLeaderboardLayout } from "./layout-integration";

export const counterGraph = new Graph("compat-matrix");

// ── 1. GraphReFly raw ─────────────────────────────────────
// Direct node access via useStore / useSubscribe
export const rawNode = state(0, { name: "graphrefly/count" });
counterGraph.add("graphrefly/count", rawNode);

// Derived: doubled — using GraphReFly's native `derived` primitive
export const rawDoubledNode = derived(
	[rawNode],
	([n]) => ((n as number) ?? 0) * 2,
	{ name: "graphrefly/doubled" },
);
counterGraph.add("graphrefly/doubled", rawDoubledNode);

// ── 2. Jotai compat ───────────────────────────────────────
// Backing node for the jotai atom
export const jotaiNode = state(0, { name: "jotai/count" });
counterGraph.add("jotai/count", jotaiNode);

// Jotai writable derived atom: reads from jotaiNode, writes to jotaiNode.
// autoTrackNode inside createDerivedAtom uses `a._node` for tracking,
// so a minimal shape with just `_node` is sufficient.
export const jotaiCounter = jotaiAtom(
	(get) => get({ _node: jotaiNode } as any) ?? 0,
	(_get, _set, v: number) => jotaiNode.emit(v),
);

// Derived: doubled — using Jotai's read-only derived atom API
export const jotaiDoubled = jotaiAtom(
	(get) => ((get({ _node: jotaiNode } as any) as number) ?? 0) * 2,
);

// ── 3. Nanostores compat ──────────────────────────────────
// Backing node for the nanostores atom
export const nanoNode = state(0, { name: "nanostores/count" });
counterGraph.add("nanostores/count", nanoNode);

// Nanostores atom — synced bidirectionally with nanoNode.
// Re-entrancy guard prevents infinite loop: set → listen → emit → subscribe → set → ...
export const nanoCounter = nanoAtom(0);
let nanoSyncing = false;
// nanoNode → nanoCounter (push changes from graph to atom)
nanoNode.subscribe((msgs) => {
	if (nanoSyncing) return;
	for (const [t, v] of msgs) {
		if (t === DATA) {
			nanoSyncing = true;
			nanoCounter.set(v as number);
			nanoSyncing = false;
		}
	}
});
// nanoCounter → nanoNode (push changes from atom to graph, skip initial)
nanoCounter.listen((v) => {
	if (nanoSyncing) return;
	nanoSyncing = true;
	nanoNode.emit(v);
	nanoSyncing = false;
});

// Derived: doubled — using Nanostores' native `computed` API
export const nanoDoubled = nanoComputed(nanoCounter, (n) => (n ?? 0) * 2);

// ── 4. Zustand compat ─────────────────────────────────────
type ZustandState = { count: number; inc: () => void; dec: () => void };
export const zustandStore = zustandCreate<ZustandState>((set, get) => ({
	count: 0,
	inc: () => set((s) => ({ ...s, count: s.count + 1 })),
	dec: () => set((s) => ({ ...s, count: s.count - 1 })),
}));
// Add zustand's internal state node to the shared graph for mermaid visualization
const zustandStateNode = zustandStore.resolve("state") as Node<ZustandState>;
counterGraph.add("zustand/state", zustandStateNode);

// Derived node extracting just the count from zustand state (for useSubscribeRecord)
export const zustandCountNode = derived(
	[zustandStateNode],
	([s]) => (s as ZustandState | null)?.count ?? 0,
	{ name: "zustand/count" },
);
counterGraph.add("zustand/count", zustandCountNode);

// Derived: doubled — zustand has no computed() API, so the idiomatic
// pattern is a selector `(s) => s.count * 2`. Framework code calls this
// through useSyncExternalStore-with-selector (React/Vue/Solid/Svelte).
export const zustandDoubledSelector = (s: ZustandState | null): number =>
	((s?.count ?? 0) as number) * 2;

// ── Total (for useSubscribe demo) ─────────────────────────
export const totalNode = derived(
	[rawNode, jotaiNode, nanoNode, zustandCountNode],
	([a, b, c, d]) =>
		((a as number) || 0) + ((b as number) || 0) + ((c as number) || 0) + ((d as number) || 0),
	{ name: "total" },
);
counterGraph.add("total", totalNode);

// ── Keys + factory for useSubscribeRecord demo ────────────
export const keysNode = state(["graphrefly", "jotai", "nanostores", "zustand"] as string[], {
	name: "counter-keys",
});
counterGraph.add("counter-keys", keysNode);

export const counterNodeFactory = (key: string): { count: Node<number> } => {
	const map: Record<string, Node<number>> = {
		graphrefly: rawNode as Node<number>,
		jotai: jotaiNode as Node<number>,
		nanostores: nanoNode as Node<number>,
		zustand: zustandCountNode as Node<number>,
	};
	return { count: map[key] ?? (rawNode as Node<number>) };
};

// ── Reactive-layout integration: leaderboard block-flow positions ─────────
// Rebuilds when `keysNode` emits new library labels — each framework can
// subscribe to `leaderboardTotalHeight` for an auto-sizing leaderboard.
const leaderboardLayout = createLeaderboardLayout(
	["graphrefly", "jotai", "nanostores", "zustand"].map(
		(k) => `${k.toUpperCase()}  ${k}/count`,
	),
);
export const leaderboardTotalHeight = leaderboardLayout.totalHeight;
keysNode.subscribe((msgs) => {
	for (const [t, v] of msgs) {
		if (t === DATA) {
			leaderboardLayout.setBlocks(
				(v as string[]).map((k) => `${k.toUpperCase()}  ${k}/count`),
			);
		}
	}
});

// Code snippet strings (shown in the demo shell's code pane).
//
// Library-specific snippets (jotai / nanostores / zustand) describe the
// compat library's *own* API — framework-agnostic, so they're shared.
// Framework-specific snippets (`graphrefly` direct bindings and the
// `leaderboard` using `useSubscribeRecord`) are parameterised per
// framework below and selected via `getCodeSnippets(framework)`.

export type FrameworkName = "react" | "vue" | "solid" | "svelte";

const GRAPHREFLY_BY_FRAMEWORK: Record<FrameworkName, string> = {
	react: `// GraphReFly — direct node binding + native derived() [React]
import { state, derived } from "@graphrefly/graphrefly";
import { useStore, useSubscribe } from "@graphrefly/graphrefly/compat/react";

const count   = state(0, { name: "count" });
const doubled = derived([count], ([n]) => (n ?? 0) * 2);

function Counter() {
  const [value, setValue] = useStore(count);   // [value, setter]
  const dbl = useSubscribe(doubled);           // read-only value

  return (
    <div>
      <button onClick={() => setValue((value ?? 0) - 1)}>-</button>
      <span>{value} · doubled = {dbl}</span>
      <button onClick={() => setValue((value ?? 0) + 1)}>+</button>
    </div>
  );
}`,
	vue: `<!-- GraphReFly — direct node binding + native derived() [Vue] -->
<script setup lang="ts">
import { state, derived } from "@graphrefly/graphrefly";
import { useStore, useSubscribe } from "@graphrefly/graphrefly/compat/vue";

const count   = state(0, { name: "count" });
const doubled = derived([count], ([n]) => (n ?? 0) * 2);

// useStore → writable Ref (v-model friendly)
const value = useStore(count);
// useSubscribe → read-only Ref from any node, including derived
const dbl = useSubscribe(doubled);
</script>

<template>
  <div>
    <button @click="value = (value ?? 0) - 1">-</button>
    <span>{{ value }} · doubled = {{ dbl }}</span>
    <button @click="value = (value ?? 0) + 1">+</button>
  </div>
</template>`,
	solid: `// GraphReFly — direct node binding + native derived() [SolidJS]
import { state, derived } from "@graphrefly/graphrefly";
import { useStore, useSubscribe } from "@graphrefly/graphrefly/compat/solid";

const count   = state(0, { name: "count" });
const doubled = derived([count], ([n]) => (n ?? 0) * 2);

export function Counter() {
  // useStore → [Accessor<T>, setter]
  const [value, setValue] = useStore(count);
  const dbl = useSubscribe(doubled);           // Accessor<number | null>

  return (
    <div>
      <button onClick={() => setValue((value() ?? 0) - 1)}>-</button>
      <span>{value()} · doubled = {dbl()}</span>
      <button onClick={() => setValue((value() ?? 0) + 1)}>+</button>
    </div>
  );
}`,
	svelte: `<!-- GraphReFly — direct node binding + native derived() [Svelte] -->
<script lang="ts">
  import { state, derived } from "@graphrefly/graphrefly";
  import { useStore, useSubscribe } from "@graphrefly/graphrefly/compat/svelte";

  const count   = state(0, { name: "count" });
  const doubled = derived([count], ([n]) => (n ?? 0) * 2);

  // useStore → Svelte writable store; useSubscribe → readable store.
  // Auto-subscribe via the \`$\` prefix in the template.
  const value = useStore(count);
  const dbl   = useSubscribe(doubled);
</script>

<div>
  <button on:click={() => $value = ($value ?? 0) - 1}>-</button>
  <span>{$value} · doubled = {$dbl}</span>
  <button on:click={() => $value = ($value ?? 0) + 1}>+</button>
</div>`,
};

const LEADERBOARD_BY_FRAMEWORK: Record<FrameworkName, string> = {
	react: `// Leaderboard — useSubscribeRecord maps a keys node through a factory [React]
import {
  useSubscribeRecord,
  useSubscribe,
} from "@graphrefly/graphrefly/compat/react";

const keys = state(["graphrefly", "jotai", "nanostores", "zustand"]);

// factory: (key) => { count: Node<number> }
// reacts to key additions/removals AND inner count changes
const record = useSubscribeRecord(keys, (key) => ({
  count: nodeForKey(key),
}));

const total = useSubscribe(totalNode);

return (
  <ul>
    {Object.entries(record).map(([k, v]) => <li>{k}: {v.count}</li>)}
    <li>Total: {total}</li>
  </ul>
);`,
	vue: `<!-- Leaderboard — useSubscribeRecord maps a keys node through a factory [Vue] -->
<script setup lang="ts">
import {
  useSubscribeRecord,
  useSubscribe,
} from "@graphrefly/graphrefly/compat/vue";

const keys = state(["graphrefly", "jotai", "nanostores", "zustand"]);

// record is a reactive object; re-keyed when \`keys\` changes
const record = useSubscribeRecord(keys, (key) => ({
  count: nodeForKey(key),
}));
const total = useSubscribe(totalNode);
</script>

<template>
  <ul>
    <li v-for="[k, v] in Object.entries(record)" :key="k">{{ k }}: {{ v.count }}</li>
    <li>Total: {{ total }}</li>
  </ul>
</template>`,
	solid: `// Leaderboard — useSubscribeRecord maps a keys node through a factory [SolidJS]
import {
  useSubscribeRecord,
  useSubscribe,
} from "@graphrefly/graphrefly/compat/solid";

const keys = state(["graphrefly", "jotai", "nanostores", "zustand"]);

// record is Accessor<Record<string, { count: number }>>
const record = useSubscribeRecord(keys, (key) => ({
  count: nodeForKey(key),
}));
const total = useSubscribe(totalNode);

return (
  <ul>
    <For each={Object.entries(record())}>
      {([k, v]) => <li>{k}: {v.count}</li>}
    </For>
    <li>Total: {total()}</li>
  </ul>
);`,
	svelte: `<!-- Leaderboard — useSubscribeRecord maps a keys node through a factory [Svelte] -->
<script lang="ts">
  import {
    useSubscribeRecord,
    useSubscribe,
  } from "@graphrefly/graphrefly/compat/svelte";

  const keys = state(["graphrefly", "jotai", "nanostores", "zustand"]);

  // recordStore is a Svelte readable store; \`$recordStore\` auto-subscribes.
  const recordStore = useSubscribeRecord(keys, (key) => ({
    count: nodeForKey(key),
  }));
  const totalStore = useSubscribe(totalNode);
</script>

<ul>
  {#each Object.entries($recordStore) as [k, v]}
    <li>{k}: {v.count}</li>
  {/each}
  <li>Total: {$totalStore}</li>
</ul>`,
};

const SHARED_SNIPPETS = {
	jotai: `// Jotai compat — atom API over GraphReFly node
import { state } from "@graphrefly/graphrefly";
import { atom } from "@graphrefly/graphrefly/compat/jotai";

const countNode = state(0, { name: "count" });

// Writable derived atom — reads + writes countNode
const counter = atom(
  (get) => get({ _node: countNode, ... }) ?? 0,
  (_get, _set, v: number) => countNode.emit(v),
);

// Read-only derived atom — Jotai's native computed pattern
const doubled = atom((get) => (get(counter) ?? 0) * 2);

// counter.get() / .set(v) / .subscribe(cb) / .update(fn)
// doubled.get() / .subscribe(cb)  (read-only)`,

	nanostores: `// Nanostores compat — atom + computed API
import { atom, computed } from "@graphrefly/graphrefly/compat/nanostores";

const counter = atom(0);
// counter.get()            → current value
// counter.set(v)           → emit to GraphReFly node
// counter.subscribe(cb)    → fires immediately with current value
// counter.listen(cb)       → fires only on changes

// Computed from the counter atom
const doubled = computed(counter, (n) => (n ?? 0) * 2);

// Bidirectional: nanostores atom <-> GraphReFly state node
// Changes in one propagate to the other reactively`,

	zustand: `// Zustand compat — store API + selector-based derivation
import { create } from "@graphrefly/graphrefly/compat/zustand";

const store = create<{ count: number; inc: () => void; dec: () => void }>(
  (set, get) => ({
    count: 0,
    inc: () => set({ count: get().count + 1 }),
    dec: () => set({ count: get().count - 1 }),
  })
);

// Zustand has no native computed() — derive via selectors at read time:
const doubled = (s) => s.count * 2;

// React/Vue/Solid/Svelte subscribe with the selector:
//   useSyncExternalStore(store.subscribe, () => doubled(store.getState()))

// Backed by a GraphReFly state node — inspectable, snapshotable, diffable`,
};

/** Per-framework code-snippet bundle. The `graphrefly` and `leaderboard`
 *  entries are framework-specific; the others are shared. */
export function getCodeSnippets(framework: FrameworkName): Record<string, string> {
	return {
		graphrefly: GRAPHREFLY_BY_FRAMEWORK[framework],
		jotai: SHARED_SNIPPETS.jotai,
		nanostores: SHARED_SNIPPETS.nanostores,
		zustand: SHARED_SNIPPETS.zustand,
		leaderboard: LEADERBOARD_BY_FRAMEWORK[framework],
	};
}

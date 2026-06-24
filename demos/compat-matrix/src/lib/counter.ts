import {
	zustandStore as createZustandStore,
	type JotaiAtom,
	jotaiAtom,
	type NanoAtom,
	type NodeRecordFactory,
	nanoAtom,
	type WritableJotaiAtom,
	type WritableNanoAtom,
	type WritableNode,
	type ZustandStoreApi,
} from "@graphrefly/ts/adapters";
import { type Graph, graph, type Node } from "@graphrefly/ts/graph";
import { createLeaderboardLayout } from "./layout-integration";

export const counterGraph: Graph = graph({ name: "compat-matrix" });

// 1. GraphReFly raw: direct node access through focused framework adapters.
export const rawNode = counterGraph.state(0, { name: "graphrefly/count" });
export const rawDoubledNode = counterGraph.derived([rawNode], (n) => (n ?? 0) * 2, {
	name: "graphrefly/doubled",
});

// 2. Jotai-style facade over caller-owned GraphReFly nodes.
export const jotaiNode = counterGraph.state(0, { name: "jotai/count" });
export const jotaiCounter: WritableJotaiAtom<number> = jotaiAtom(jotaiNode);
export const jotaiDoubledNode = counterGraph.derived([jotaiNode], (n) => (n ?? 0) * 2, {
	name: "jotai/doubled",
});
export const jotaiDoubled: JotaiAtom<number> = jotaiAtom(jotaiDoubledNode);

// 3. Nanostores-style facade over caller-owned GraphReFly nodes.
export const nanoNode = counterGraph.state(0, { name: "nanostores/count" });
export const nanoCounter: WritableNanoAtom<number> = nanoAtom(nanoNode);
export const nanoDoubledNode = counterGraph.derived([nanoNode], (n) => (n ?? 0) * 2, {
	name: "nanostores/doubled",
});
export const nanoDoubled: NanoAtom<number> = nanoAtom(nanoDoubledNode);

// 4. Zustand-compatible facade. The graph node carries serializable state;
// the store snapshot adds the caller-owned commands expected by Zustand users.
type ZustandNodeState = { count: number };
export type ZustandState = ZustandNodeState & { inc: () => void; dec: () => void };

export const zustandCountNode = counterGraph.state<ZustandNodeState>(
	{ count: 0 },
	{ name: "zustand/count" },
);

let cachedZustandCount: number | undefined;
let cachedZustandSnapshot: ZustandState | undefined;
function zustandSnapshot(): ZustandState {
	const base = zustandCountNode.cache ?? { count: 0 };
	if (cachedZustandSnapshot && cachedZustandCount === base.count) return cachedZustandSnapshot;
	cachedZustandCount = base.count;
	cachedZustandSnapshot = {
		count: base.count,
		inc: () => zustandStoreRef?.setState((state) => ({ count: state.count + 1 })),
		dec: () => zustandStoreRef?.setState((state) => ({ count: state.count - 1 })),
	};
	return cachedZustandSnapshot;
}

function zustandWriteSnapshot(value: ZustandState): ZustandNodeState {
	return {
		count: value.count,
	};
}

let zustandStoreRef: ZustandStoreApi<ZustandState> | undefined;
export const zustandStore: ZustandStoreApi<ZustandState> = createZustandStore(
	zustandCountNode as unknown as WritableNode<ZustandState>,
	zustandSnapshot(),
	{
		getSnapshot: () => zustandSnapshot(),
		write: (_node, value) => {
			zustandCountNode.set(zustandWriteSnapshot(value));
		},
	},
);
zustandStoreRef = zustandStore;

export const zustandDoubledSelector = (s: ZustandState | null): number => (s?.count ?? 0) * 2;

export const zustandCountValueNode = counterGraph.derived(
	[zustandCountNode],
	(state) => state?.count ?? 0,
	{ name: "zustand/count-value" },
);

// Total and keyed-record demo nodes.
export const totalNode = counterGraph.derived(
	[rawNode, jotaiNode, nanoNode, zustandCountValueNode],
	(a, b, c, d) => (a ?? 0) + (b ?? 0) + (c ?? 0) + (d ?? 0),
	{ name: "total" },
);

export const keysNode = counterGraph.state<readonly string[]>(
	["graphrefly", "jotai", "nanostores", "zustand"],
	{ name: "counter-keys" },
);

export const counterNodeFactory: NodeRecordFactory<string, { count: number }> = (key) => {
	const map: Record<string, Node<number>> = {
		graphrefly: rawNode,
		jotai: jotaiNode,
		nanostores: nanoNode,
		zustand: zustandCountValueNode,
	};
	return { count: map[key] ?? rawNode };
};

// Reactive-layout integration: leaderboard block-flow positions.
const leaderboardLayout = createLeaderboardLayout(
	["graphrefly", "jotai", "nanostores", "zustand"].map((k) => `${k.toUpperCase()}  ${k}/count`),
);
export const leaderboardTotalHeight = leaderboardLayout.totalHeight;
keysNode.subscribe((msg) => {
	if (msg[0] === "DATA") {
		leaderboardLayout.setBlocks(
			(msg[1] as readonly string[]).map((k) => `${k.toUpperCase()}  ${k}/count`),
		);
	}
});

export type FrameworkName = "react" | "vue" | "solid" | "svelte";

const GRAPHREFLY_BY_FRAMEWORK: Record<FrameworkName, string> = {
	react: `// GraphReFly direct node binding [React]
import { graph } from "@graphrefly/ts/graph";
import { useNodeInput, useNodeValue } from "@graphrefly/ts/adapters/react";

const g = graph({ name: "counter" });
const count = g.state(0, { name: "count" });
const doubled = g.derived([count], (n) => (n ?? 0) * 2, { name: "doubled" });

function Counter() {
  const [value, setValue] = useNodeInput(count);
  const dbl = useNodeValue(doubled);

  return (
    <div>
      <button onClick={() => setValue((value ?? 0) - 1)}>-</button>
      <span>{value} / doubled = {dbl}</span>
      <button onClick={() => setValue((value ?? 0) + 1)}>+</button>
    </div>
  );
}`,
	vue: `<!-- GraphReFly direct node binding [Vue] -->
<script setup lang="ts">
import { graph } from "@graphrefly/ts/graph";
import { useNodeInput, useNodeValue } from "@graphrefly/ts/adapters/vue";

const g = graph({ name: "counter" });
const count = g.state(0, { name: "count" });
const doubled = g.derived([count], (n) => (n ?? 0) * 2, { name: "doubled" });

const [value, setValue] = useNodeInput(count);
const dbl = useNodeValue(doubled);
</script>

<template>
  <div>
    <button @click="setValue((value ?? 0) - 1)">-</button>
    <span>{{ value }} / doubled = {{ dbl }}</span>
    <button @click="setValue((value ?? 0) + 1)">+</button>
  </div>
</template>`,
	solid: `// GraphReFly direct node binding [SolidJS]
import { graph } from "@graphrefly/ts/graph";
import { createNodeInput, createNodeValue } from "@graphrefly/ts/adapters/solid";

const g = graph({ name: "counter" });
const count = g.state(0, { name: "count" });
const doubled = g.derived([count], (n) => (n ?? 0) * 2, { name: "doubled" });

export function Counter() {
  const [value, setValue] = createNodeInput(count);
  const dbl = createNodeValue(doubled);

  return (
    <div>
      <button onClick={() => setValue((value() ?? 0) - 1)}>-</button>
      <span>{value()} / doubled = {dbl()}</span>
      <button onClick={() => setValue((value() ?? 0) + 1)}>+</button>
    </div>
  );
}`,
	svelte: `<!-- GraphReFly direct node binding [Svelte] -->
<script lang="ts">
  import { graph } from "@graphrefly/ts/graph";
  import { nodeWritable, nodeReadable } from "@graphrefly/ts/adapters/svelte";

  const g = graph({ name: "counter" });
  const count = g.state(0, { name: "count" });
  const doubled = g.derived([count], (n) => (n ?? 0) * 2, { name: "doubled" });

  const value = nodeWritable(count);
  const dbl = nodeReadable(doubled);
</script>

<div>
  <button on:click={() => $value = ($value ?? 0) - 1}>-</button>
  <span>{$value} / doubled = {$dbl}</span>
  <button on:click={() => $value = ($value ?? 0) + 1}>+</button>
</div>`,
};

const LEADERBOARD_BY_FRAMEWORK: Record<FrameworkName, string> = {
	react: `// Leaderboard: useNodeRecord maps keys through a node factory [React]
import { useNodeRecord, useNodeValue } from "@graphrefly/ts/adapters/react";

const keys = g.state(["graphrefly", "jotai", "nanostores", "zustand"]);
const record = useNodeRecord(keys, (key) => ({ count: nodeForKey(key) }));
const total = useNodeValue(totalNode);

return (
  <ul>
    {Object.entries(record).map(([k, v]) => <li key={k}>{k}: {v.count}</li>)}
    <li>Total: {total}</li>
  </ul>
);`,
	vue: `<!-- Leaderboard: useNodeRecord maps keys through a node factory [Vue] -->
<script setup lang="ts">
import { useNodeRecord, useNodeValue } from "@graphrefly/ts/adapters/vue";

const keys = g.state(["graphrefly", "jotai", "nanostores", "zustand"]);
const record = useNodeRecord(keys, (key) => ({ count: nodeForKey(key) }));
const total = useNodeValue(totalNode);
</script>

<template>
  <ul>
    <li v-for="[k, v] in Object.entries(record)" :key="k">{{ k }}: {{ v.count }}</li>
    <li>Total: {{ total }}</li>
  </ul>
</template>`,
	solid: `// Leaderboard: createNodeRecord maps keys through a node factory [SolidJS]
import { createNodeRecord, createNodeValue } from "@graphrefly/ts/adapters/solid";

const keys = g.state(["graphrefly", "jotai", "nanostores", "zustand"]);
const record = createNodeRecord(keys, (key) => ({ count: nodeForKey(key) }));
const total = createNodeValue(totalNode);

return (
  <ul>
    <For each={Object.entries(record())}>
      {([k, v]) => <li>{k}: {v.count}</li>}
    </For>
    <li>Total: {total()}</li>
  </ul>
);`,
	svelte: `<!-- Leaderboard: nodeRecord maps keys through a node factory [Svelte] -->
<script lang="ts">
  import { nodeRecord, nodeReadable } from "@graphrefly/ts/adapters/svelte";

  const keys = g.state(["graphrefly", "jotai", "nanostores", "zustand"]);
  const recordStore = nodeRecord(keys, (key) => ({ count: nodeForKey(key) }));
  const totalStore = nodeReadable(totalNode);
</script>

<ul>
  {#each Object.entries($recordStore) as [k, v]}
    <li>{k}: {v.count}</li>
  {/each}
  <li>Total: {$totalStore}</li>
</ul>`,
};

const SHARED_SNIPPETS = {
	jotai: `// Jotai-style facade over a caller-owned GraphReFly node
import { graph } from "@graphrefly/ts/graph";
import { jotaiAtom } from "@graphrefly/ts/adapters";

const g = graph({ name: "jotai-counter" });
const countNode = g.state(0, { name: "count" });
const counter = jotaiAtom(countNode);

const doubledNode = g.derived([countNode], (n) => (n ?? 0) * 2, {
  name: "doubled",
});
const doubled = jotaiAtom(doubledNode);

counter.get();
counter.set(1);
counter.subscribe((value) => console.log(value));
doubled.subscribe((value) => console.log(value));`,

	nanostores: `// Nanostores-style facade over a caller-owned GraphReFly node
import { graph } from "@graphrefly/ts/graph";
import { nanoAtom } from "@graphrefly/ts/adapters";

const g = graph({ name: "nano-counter" });
const countNode = g.state(0, { name: "count" });
const counter = nanoAtom(countNode);

const doubledNode = g.derived([countNode], (n) => (n ?? 0) * 2, {
  name: "doubled",
});
const doubled = nanoAtom(doubledNode);

counter.get();
counter.set(1);
counter.listen((value) => console.log(value));
doubled.subscribe((value) => console.log(value));`,

	zustand: `// Zustand-compatible facade over a caller-owned GraphReFly node
import { graph } from "@graphrefly/ts/graph";
import { zustandStore } from "@graphrefly/ts/adapters";

const g = graph({ name: "zustand-counter" });
const countNode = g.state({ count: 0 }, { name: "count" });
const store = zustandStore(countNode);

store.setState((state) => ({ count: state.count + 1 }));
store.subscribe((state) => console.log(state.count));

// Zustand-style computed values stay selectors at read time.
const doubled = (state: { count: number }) => state.count * 2;
const currentDoubled = doubled(store.getState());`,
};

/** Per-framework code-snippet bundle. */
export function getCodeSnippets(framework: FrameworkName): Record<string, string> {
	return {
		graphrefly: GRAPHREFLY_BY_FRAMEWORK[framework],
		jotai: SHARED_SNIPPETS.jotai,
		nanostores: SHARED_SNIPPETS.nanostores,
		zustand: SHARED_SNIPPETS.zustand,
		leaderboard: LEADERBOARD_BY_FRAMEWORK[framework],
	};
}

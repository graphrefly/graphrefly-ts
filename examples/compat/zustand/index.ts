/**
 * Zustand-compatible store API backed by GraphReFly.
 *
 * - `create(initializer)` returns a `Graph & StoreApi<T>` — the store IS a
 *   graph, so you can `.add()` further nodes, introspect with `describe()`,
 *   and snapshot like any other graph.
 * - Zustand fires listeners on every `setState` regardless of reference
 *   equality, so the backing state node is constructed with a permissive
 *   `equals: () => false` to match.
 * - Derive via selectors at read time — zustand has no built-in computed.
 */
import { create } from "@graphrefly/graphrefly/compat/zustand";

type Counter = {
	count: number;
	inc: () => void;
	dec: () => void;
	reset: () => void;
};

const store = create<Counter>((set, get) => ({
	count: 0,
	inc: () => set({ count: get().count + 1 }),
	dec: () => set({ count: get().count - 1 }),
	reset: () => set({ count: 0 }),
}));

// Selector-based derivation (zustand idiom).
const doubled = (s: Counter) => s.count * 2;

const unsub = store.subscribe((state, prev) => {
	console.log(`count ${prev.count} → ${state.count} · doubled: ${doubled(state)}`);
});

store.getState().inc(); // count 0 → 1 · doubled: 2
store.getState().inc(); // count 1 → 2 · doubled: 4
store.getState().dec(); // count 2 → 1 · doubled: 2
store.getState().reset(); // count 1 → 0 · doubled: 0

// The store is a Graph — use `describe()` or `snapshot()` for introspection.
console.log("graph snapshot:", store.snapshot());

unsub();
store.destroy();

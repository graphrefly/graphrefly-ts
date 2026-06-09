/**
 * Zustand-compatible StoreApi backed by a caller-owned GraphReFly state node.
 *
 * The example uses the dependency-free adapter surface from
 * `@graphrefly/ts/adapters`; it does not recreate the old compat namespace or
 * a store-owned Graph factory.
 */
import { graph } from "@graphrefly/ts";
import { zustandStore } from "@graphrefly/ts/adapters";

type CounterState = {
	count: number;
};

const g = graph({ name: "zustand-example" });
const counter = g.state<CounterState>({ count: 0 }, { name: "counter" });
const store = zustandStore(counter);

// Selector-based derivation (zustand idiom).
const doubled = (s: CounterState) => s.count * 2;
const inc = () => store.setState((state) => ({ count: state.count + 1 }));
const dec = () => store.setState((state) => ({ count: state.count - 1 }));
const reset = () => store.setState({ count: 0 });

const unsub = store.subscribe((state, prev) => {
	console.log(`count ${prev.count} -> ${state.count} / doubled: ${doubled(state)}`);
});

inc(); // count 0 -> 1 / doubled: 2
inc(); // count 1 -> 2 / doubled: 4
dec(); // count 2 -> 1 / doubled: 2
reset(); // count 1 -> 0 / doubled: 0

console.log(
	"graph nodes:",
	g.describe().nodes.map((node) => node.name ?? node.id),
);
console.log(
	"graph checkpoint nodes:",
	g.checkpoint().nodes.map((node) => node.id),
);

unsub();
store.destroy();

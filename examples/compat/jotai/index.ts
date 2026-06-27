/**
 * Jotai-style atom facade over caller-owned GraphReFly nodes.
 *
 * `jotaiAtom(node)` exposes a tiny atom-like surface plus `._node` for direct
 * GraphReFly composition. Derived reads stay graph-owned via `g.derived(...)`.
 */
import { graph } from "@graphrefly/ts";
import { jotaiAtom } from "@graphrefly/ts/adapters";

const g = graph({ name: "jotai-example" });

// Primitive writable atom over a clean-slate state node.
const countNode = g.state(0, { name: "count" });
const count = jotaiAtom(countNode);

// Read-only derived atom over a clean-slate derived node.
const doubledNode = g.derived([countNode], (n) => n * 2, { name: "doubled" });
const doubled = jotaiAtom(doubledNode);

// Observe via Jotai's surface API. Jotai-style `subscribe` fires only on
// changes — it does NOT deliver the initial value.
const unsubDoubled = doubled.subscribe((v) => console.log("doubled:", v));

// Direct node subscriptions still honor push-on-subscribe.
const unsubRaw = count._node.subscribe(([type, data]) => {
	if (type === "DATA") console.log("count._node DATA:", data);
});
// -> count._node DATA: 0

count.set(1); // doubled: 2 / count._node DATA: 1
count.set(5); // doubled: 10 / count._node DATA: 5
count.update((n) => (n ?? 0) + 1); // doubled: 12 / count._node DATA: 6

unsubDoubled();
unsubRaw();

/**
 * Nanostores-style atom facade over caller-owned GraphReFly nodes.
 *
 * The computed examples are ordinary `g.derived(...)` nodes wrapped with
 * `nanoAtom`, keeping GraphReFly topology explicit and inspectable.
 */
import { graph } from "@graphrefly/ts";
import { nanoAtom } from "@graphrefly/ts/adapters";

const g = graph({ name: "nanostores-example" });
const countNode = g.state(0, { name: "count" });
const count = nanoAtom(countNode, { immediate: false });

const doubledNode = g.derived([countNode], (n) => n * 2, { name: "doubled" });
const doubled = nanoAtom(doubledNode, { immediate: false });

const offsetNode = g.state(100, { name: "offset" });
const offset = nanoAtom(offsetNode, { immediate: false });
const labelledNode = g.derived([countNode, offsetNode], (n, o) => `count+offset = ${n + o}`, {
	name: "labelled",
});
const labelled = nanoAtom(labelledNode, { immediate: false });

// `subscribe` — fires immediately with the cached value, then on every change.
const unsubDoubled = doubled.subscribe((v) => console.log("doubled:", v));
// -> doubled: 0

// `listen` — changes only, no initial call.
const unsubLabel = labelled.listen((s) => console.log("labelled:", s));

count.set(1); // doubled: 2 / labelled: count+offset = 101
count.set(5); // doubled: 10 / labelled: count+offset = 105
offset.set(200); // labelled: count+offset = 205

unsubDoubled();
unsubLabel();

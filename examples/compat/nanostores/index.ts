/**
 * Nanostores-compatible atom + computed API over GraphReFly nodes.
 *
 * - `subscribe(cb)` fires immediately with the current value (matches
 *   GraphReFly's push-on-subscribe — spec §2.2).
 * - `listen(cb)` fires only on subsequent changes.
 * - `atom._node` / `computed._node` are native GraphReFly nodes, safe to
 *   compose with `derived()` or register into a `Graph`.
 */
import { atom, computed } from "@graphrefly/graphrefly/compat/nanostores";

const count = atom(0);

// Computed — nanostores' equivalent of `derived`.
const doubled = computed(count, (n) => n * 2);

// Multi-dep computed.
const offset = atom(100);
const labelled = computed([count, offset], (n, o) => `count+offset = ${n + o}`);

// `subscribe` — fires immediately with the cached value, then on every change.
const unsubDoubled = doubled.subscribe((v) => console.log("doubled:", v));
// → doubled: 0

// `listen` — changes only, no initial call.
const unsubLabel = labelled.listen((s) => console.log("labelled:", s));

count.set(1); // doubled: 2
count.set(5); // doubled: 10 · labelled: count+offset = 105
offset.set(200); // labelled: count+offset = 205

unsubDoubled();
unsubLabel();

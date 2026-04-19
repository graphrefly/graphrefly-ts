/**
 * Jotai-compatible atom API over GraphReFly nodes.
 *
 * Shows all three `atom()` overloads plus the two-way-bridge invariant
 * (guide §26): every compat layer exposes its backing node as `._node`,
 * and that node must be wave-correct when observed directly.
 */

import { atom } from "@graphrefly/graphrefly/compat/jotai";
import { DATA } from "@graphrefly/graphrefly/core";

// 1. Primitive (writable) atom — wraps `state()` under the hood.
const count = atom(0);

// 2. Read-only derived atom — `atom((get) => ...)` wraps `dynamicNode`.
const doubled = atom((get) => (get(count) ?? 0) * 2);

// 3. Writable derived atom — read + custom write (here: clamp to [0, 10]).
const clamped = atom(
	(get) => get(count) ?? 0,
	(_get, _set, v: number) => count.set(Math.max(0, Math.min(10, v))),
);

// Observe via Jotai's surface API. Jotai-style `subscribe` fires only on
// changes — it does NOT deliver the initial value.
const unsubDoubled = doubled.subscribe((v) => console.log("doubled:", v));

// Two-way-bridge check (guide §26): subscribe directly to the backing node.
// Raw node subscriptions honor push-on-subscribe (spec §2.2) — the first
// emission is the currently cached value, delivered synchronously on subscribe.
const unsubRaw = count._node.subscribe((msgs) => {
	for (const [t, v] of msgs) {
		if (t === DATA) console.log("count._node DATA:", v);
	}
});
// → count._node DATA: 0   (push-on-subscribe of cached state)

count.set(1); // doubled: 2 · count._node DATA: 1
count.set(5); // doubled: 10 · count._node DATA: 5
count.update((n) => n + 1); // doubled: 12 · count._node DATA: 6
clamped.set(99); // clamp → count := 10 → doubled: 20 · count._node DATA: 10

unsubDoubled();
unsubRaw();

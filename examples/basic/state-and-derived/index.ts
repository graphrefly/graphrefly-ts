/**
 * Basic reactive counter — the simplest GraphReFly example.
 *
 * Shows `state()`, `derived()`, and subscribing through the message protocol.
 *
 * Spec references:
 * - §2.2: `subscribe()` delivers `[[START], [DATA, cached]]` — subscribers
 *   receive the current cached value as the first DATA tuple.
 * - §1.3.3: equals substitution — emitting the same value again produces
 *   `[RESOLVED]` instead of `[DATA, v]`, so downstream does not re-run.
 */
import { DATA, derived, state } from "@graphrefly/graphrefly";

// Source node. ROM: its cache persists across subscriber churn.
const count = state(0);

// Derived node — recomputes whenever `count` emits DATA. Sugar wraps the user
// fn and calls `actions.emit(value)` internally (see spec §2.8).
const doubled = derived([count], ([n]) => (n as number) * 2);

// Subscribe — filter DATA tuples out of the message stream. On subscribe the
// sink receives `[[START], [DATA, 0]]`, so you'll see `doubled: 0` first.
const unsub = doubled.subscribe((msgs) => {
	for (const [type, data] of msgs) {
		if (type === DATA) console.log("doubled:", data);
	}
});
// → doubled: 0

count.emit(1); // → doubled: 2
count.emit(2); // → doubled: 4
count.emit(3); // → doubled: 6
count.emit(3); // (no emission — equals substitution turns this into RESOLVED)

unsub();

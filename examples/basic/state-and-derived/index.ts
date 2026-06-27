/**
 * Basic reactive counter — the simplest GraphReFly example.
 *
 * Shows clean-slate `graph().state()`, `derived()`, and subscribing through the
 * message protocol.
 *
 * Clean-slate note: every value occurrence is DATA (D49); RESOLVED is only the
 * substrate-synthesized "undirty / no occurrence" settle.
 */
import { graph } from "@graphrefly/ts";

const g = graph({ name: "counter" });

// Source node. Its cache persists across subscriber churn.
const count = g.state(0, { name: "count" });

// Derived node — recomputes whenever `count` emits DATA.
const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });

// Subscribe — filter DATA tuples out of the message stream. On subscribe the
// sink receives START and cached DATA, so you'll see `doubled: 0` first.
const unsub = doubled.subscribe(([type, data]) => {
	if (type === "DATA") console.log("doubled:", data);
});
// → doubled: 0

count.set(1); // → doubled: 2
count.set(2); // → doubled: 4
count.set(3); // → doubled: 6
count.set(3); // → doubled: 6 (D49: this is another DATA occurrence)

unsub();

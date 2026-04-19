/**
 * Basic reactive counter — the simplest GraphReFly example.
 *
 * Demonstrates: `state()`, `derived()`, and `subscribe()` with the `DATA` message type.
 */
import { DATA, derived, state } from "@graphrefly/graphrefly";

// A manual source node with initial value 0.
const count = state(0);

// A derived node that doubles the count.
const doubled = derived([count], ([n]) => (n as number) * 2);

// Subscribe to changes (messages are `Messages`: an array of `[Type, data?]` tuples).
const unsub = doubled.subscribe((msgs) => {
	for (const [type, data] of msgs) {
		if (type === DATA) console.log("doubled:", data);
	}
});

// Push values.
count.push(1); // doubled: 2
count.push(2); // doubled: 4
count.push(3); // doubled: 6

unsub();

/**
 * Basic reactive counter — the simplest GraphReFly example.
 *
 * Demonstrates: state(), derived(), node subscription via .sinks.
 */
import { derived, state } from "@graphrefly/graphrefly-ts";

// A manual source node with initial value 0.
const count = state(0);

// A derived node that doubles the count.
const doubled = derived([count], ([n]) => (n as number) * 2);

// Subscribe to changes.
doubled.sinks.add((msgs) => {
	for (const [type, data] of msgs) {
		if (type === 1) console.log("doubled:", data); // DATA = 1
	}
});

// Push values.
count.push(1); // doubled: 2
count.push(2); // doubled: 4
count.push(3); // doubled: 6

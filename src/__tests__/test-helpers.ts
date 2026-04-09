/**
 * Shared test utilities for subscribing to nodes and collecting messages.
 *
 * All helpers filter out the §2.2 START handshake — tests care about
 * post-handshake message flow, not the subscribe acknowledgment.
 */
import { START } from "../core/messages.js";

type Subscribable = { subscribe: (fn: (m: unknown) => void) => () => void };

/**
 * Subscribe and collect message **batches**, filtering START.
 * Each sink callback invocation becomes one entry in `batches`.
 */
export function collect(node: Subscribable) {
	const batches: unknown[][] = [];
	const unsub = node.subscribe((msgs) => {
		const filtered = (msgs as unknown[]).filter((m) => (m as [symbol, unknown])[0] !== START);
		if (filtered.length > 0) batches.push(filtered);
	});
	return { batches, unsub };
}

/**
 * Subscribe and collect **flat** message tuples, filtering START.
 * Each individual message `[TYPE, value?]` is pushed to `msgs`.
 * Useful for adapter tests that assert on ordered message sequences.
 */
export function collectFlat(node: Subscribable) {
	const msgs: [symbol, unknown?][] = [];
	const unsub = node.subscribe((m) => {
		for (const msg of m as [symbol, unknown?][]) {
			if (msg[0] !== START) msgs.push(msg);
		}
	});
	return { msgs, unsub };
}

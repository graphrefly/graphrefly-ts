/**
 * Shared test utilities for AI adapter tests.
 */
import { START } from "@graphrefly/pure-ts/core/messages.js";

type Subscribable = { subscribe: (fn: (m: unknown) => void) => () => void };

type CollectFlatResult = {
	messages: [symbol, unknown?][];
	msgs: [symbol, unknown?][];
	unsub: () => void;
};

export function collectFlat(node: Subscribable): CollectFlatResult {
	const messages: [symbol, unknown?][] = [];
	const unsub = node.subscribe((m) => {
		for (const msg of m as [symbol, unknown?][]) {
			if (msg[0] !== START) messages.push(msg);
		}
	});
	return { messages, msgs: messages, unsub };
}

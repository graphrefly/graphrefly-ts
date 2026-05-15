/**
 * Shared test utilities for subscribing to nodes and collecting messages.
 */
import { START } from "@graphrefly/pure-ts/core";

type Subscribable = { subscribe: (fn: (m: unknown) => void) => () => void };

export type CollectOptions = {
	flat?: boolean;
	raw?: boolean;
};

type CollectBatchResult = { messages: unknown[][]; batches: unknown[][]; unsub: () => void };
type CollectFlatResult = {
	messages: [symbol, unknown?][];
	msgs: [symbol, unknown?][];
	unsub: () => void;
};

export function collect(
	node: Subscribable,
	opts: CollectOptions & { flat: true },
): CollectFlatResult;
export function collect(node: Subscribable, opts?: CollectOptions): CollectBatchResult;
export function collect(
	node: Subscribable,
	opts?: CollectOptions,
): CollectBatchResult | CollectFlatResult {
	const flat = opts?.flat === true;
	const raw = opts?.raw === true;

	if (flat) {
		const messages: [symbol, unknown?][] = [];
		const unsub = node.subscribe((m) => {
			for (const msg of m as [symbol, unknown?][]) {
				if (raw || msg[0] !== START) messages.push(msg);
			}
		});
		return { messages, msgs: messages, unsub };
	}

	const messages: unknown[][] = [];
	const unsub = node.subscribe((msgs) => {
		const filtered = raw
			? (msgs as unknown[])
			: (msgs as unknown[]).filter((m) => (m as [symbol, unknown])[0] !== START);
		if (filtered.length > 0) messages.push(filtered);
	});
	return { messages, batches: messages, unsub };
}

export function collectFlat(node: Subscribable) {
	return collect(node, { flat: true });
}

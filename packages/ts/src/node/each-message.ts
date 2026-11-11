import type { Message, Wave } from "../protocol/messages.js";

/**
 * @internal Adapt a callback that looks at one message at a time to a per-array sink
 * (graphrefly-ts:D175: a sink receives each whole array). Package-internal and test-only; not a
 * public export.
 */
export function eachMessage(fn: (msg: Message) => void): (msgs: Wave) => void {
	return (msgs) => {
		for (const m of msgs) fn(m);
	};
}

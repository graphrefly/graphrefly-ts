/**
 * Test-only: record what a node's sinks receive. A sink gets whole arrays (R-wave@2), so `arrays`
 * keeps them as delivered and `msgs` flattens them in order.
 */
import type { Sink } from "../../ctx/types.js";
import type { Node } from "../../node/node.js";
import type { Message, Wave } from "../../protocol/messages.js";

export interface Subscribable {
	subscribe(sink: Sink): () => void;
}

export interface Collected {
	readonly arrays: Wave[];
	readonly msgs: Message[];
	readonly stop: () => void;
}

/** Subscribe now and record every array and message the node delivers. */
export function collect(node: Subscribable): Collected {
	const arrays: Wave[] = [];
	const msgs: Message[] = [];
	const stop = node.subscribe((incoming) => {
		arrays.push(incoming);
		for (const m of incoming) msgs.push(m);
	});
	return { arrays, msgs, stop };
}

/** Subscribe now and record the DATA values the node delivers, in order. */
export function collectData<T = unknown>(node: Node<T> | Subscribable): T[] {
	const values: T[] = [];
	node.subscribe((incoming) => {
		for (const m of incoming) if (m[0] === "DATA") values.push(m[1] as T);
	});
	return values;
}

/**
 * A sink not yet subscribed, for a test that hands it to `subscribe` itself (at a chosen moment, or
 * to more than one node): `log` keeps every array it receives, as delivered.
 */
export function arraySink(): { readonly log: Wave[]; readonly sink: Sink } {
	const log: Wave[] = [];
	return { log, sink: (msgs) => log.push(msgs) };
}

/** The message types of `msgs`, in order. */
export const types = (msgs: readonly Message[]): string[] => msgs.map((m) => m[0]);

/** The DATA values among `msgs`, in order. */
export function dataValues<T = unknown>(msgs: readonly Message[]): T[] {
	return msgs.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", unknown])[1] as T);
}

/** The last DATA value of one observed array, if it carries one. */
export function lastData<T = unknown>(event: { readonly msgs: Wave }): T | undefined {
	const values = dataValues<T>(event.msgs);
	return values.length === 0 ? undefined : values[values.length - 1];
}

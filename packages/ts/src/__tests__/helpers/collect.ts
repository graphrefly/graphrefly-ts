/**
 * Test-only: record what a node's sinks receive. A sink gets whole arrays (R-wave@2), so `arrays`
 * keeps them as delivered and `msgs` flattens them in order.
 */
import type { Message, Wave } from "../../protocol/messages.js";

export interface Subscribable {
	subscribe(sink: (msgs: Wave) => void): () => void;
}

export interface Collected {
	readonly arrays: Wave[];
	readonly msgs: Message[];
	readonly stop: () => void;
}

export function collect(node: Subscribable): Collected {
	const arrays: Wave[] = [];
	const msgs: Message[] = [];
	const stop = node.subscribe((incoming) => {
		arrays.push(incoming);
		for (const m of incoming) msgs.push(m);
	});
	return { arrays, msgs, stop };
}

/** The DATA values among `msgs`, in order. */
export function dataValues<T = unknown>(msgs: readonly Message[]): T[] {
	return msgs.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", unknown])[1] as T);
}

/** The last DATA value of one observed array, if it carries one. */
export function lastData<T = unknown>(event: { readonly msgs: Wave }): T | undefined {
	const values = dataValues<T>(event.msgs);
	return values.length === 0 ? undefined : values[values.length - 1];
}

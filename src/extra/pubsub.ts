/**
 * Lazy per-topic manual nodes (roadmap §3.2) — create topics on first access, publish with two-phase push.
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { state } from "../core/sugar.js";

/**
 * In-memory lazy topic registry: each topic is an independent {@link state} node (compare `graphrefly-py` `PubSubHub` with a process-wide lock).
 *
 * @category extra
 */
export class PubSubHub {
	private readonly topics = new Map<string, Node<unknown>>();

	/**
	 * Returns the topic node, creating it on first use.
	 *
	 * @param name - Topic key.
	 * @returns `Node` whose value is the last published payload (initially `undefined`).
	 */
	topic(name: string): Node<unknown> {
		let n = this.topics.get(name);
		if (n === undefined) {
			n = state(undefined, { describeKind: "state" });
			this.topics.set(name, n);
		}
		return n;
	}

	/**
	 * Pushes a value to the topic (two-phase `DIRTY` then `DATA`, matching other manual sources here).
	 *
	 * @param name - Topic key.
	 * @param value - Payload.
	 */
	publish(name: string, value: unknown): void {
		const t = this.topic(name);
		batch(() => {
			t.down([[DIRTY]]);
			t.down([[DATA, value]]);
		});
	}
}

/**
 * Creates an empty {@link PubSubHub} for lazy topic nodes.
 *
 * @returns A new hub with no topics until {@link PubSubHub.topic} or {@link PubSubHub.publish} runs.
 *
 * @example
 * ```ts
 * import { pubsub } from "@graphrefly/graphrefly-ts";
 *
 * const hub = pubsub();
 * const t = hub.topic("events");
 * t.subscribe((msgs) => console.log(msgs));
 * hub.publish("events", { ok: true });
 * ```
 *
 * @category extra
 */
export function pubsub(): PubSubHub {
	return new PubSubHub();
}

/**
 * Lazy per-topic manual nodes (roadmap §3.2) — create topics on first access, publish with two-phase push.
 */

import { batch } from "../core/batch.js";
import { DATA, DIRTY, TEARDOWN } from "../core/messages.js";
import { type Node, node } from "../core/node.js";

/**
 * In-memory lazy topic registry: each topic is an independent {@link state} node.
 *
 * @category extra
 */
export interface PubSubHub {
	/**
	 * Returns the topic node, creating it on first use.
	 *
	 * @param name - Topic key.
	 * @returns `Node` whose value is the last published payload. Starts in
	 *   sentinel state — no push-on-subscribe until the first publish.
	 */
	topic(name: string): Node<unknown>;

	/**
	 * Pushes a value to the topic (two-phase `DIRTY` then `DATA`, matching other manual sources here).
	 *
	 * @param name - Topic key.
	 * @param value - Payload.
	 */
	publish(name: string, value: unknown): void;

	/**
	 * Removes a topic and tears down its node. Returns `true` if the topic existed.
	 *
	 * @param name - Topic key.
	 */
	removeTopic(name: string): boolean;
}

class PubSubHubImpl implements PubSubHub {
	private readonly topics = new Map<string, Node<unknown>>();

	topic(name: string): Node<unknown> {
		let n = this.topics.get(name);
		if (n === undefined) {
			n = node<unknown>({ describeKind: "state" });
			this.topics.set(name, n);
		}
		return n;
	}

	publish(name: string, value: unknown): void {
		const t = this.topic(name);
		batch(() => {
			t.down([[DIRTY]]);
			t.down([[DATA, value]]);
		});
	}

	removeTopic(name: string): boolean {
		const n = this.topics.get(name);
		if (n === undefined) return false;
		n.down([[TEARDOWN]]);
		this.topics.delete(name);
		return true;
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
 * hub.removeTopic("events"); // tears down the node
 * ```
 *
 * @category extra
 */
export function pubsub(): PubSubHub {
	return new PubSubHubImpl();
}

/**
 * Phase 13.F — `tracker` sibling preset.
 *
 * Source: `archive/docs/SESSION-human-llm-intervention-primitives.md` §5
 * "Sibling presets on the substrate" + `archive/docs/SKETCH-reactive-tracker-factory.md`
 * + `project_reactive_tracker` memory.
 *
 * **Role.** Park-as-deferred queue consumer. The tracker is the
 * cursor-based read surface over the well-known {@link DEFERRED_TOPIC}
 * — items the harness (or any consumer) defers for later attention.
 * Sibling to `humanInput` and `approvalGate`; all three share substrate
 * (hub + envelope + reactive cursor) but differ in role.
 *
 * **Cursor handle.** Per the SESSION's "Cursor handle" return — tracker
 * exposes the cursor-based pull / ack surface so the consumer (a
 * dashboard, a post-run review, an LLM watcher) can iterate over
 * unconsumed items in order.
 *
 * **Naming locked (open question §11 #3 resolved):** `tracker`. The
 * SESSION mentioned `tracker` vs `parkedQueue` vs `deferredTracker`;
 * `tracker` is the simplest and most general — the deferred-queue
 * semantic is a recipe, not a name overload. Other use cases (issue
 * tracker, todo tracker, retrospective tracker per
 * `project_reactive_tracker`) reuse the same primitive.
 */

import type { Node } from "../../core/node.js";
import {
	DEFERRED_TOPIC,
	type MessagingHubGraph,
	type SubscriptionGraph,
	subscription,
	type TopicGraph,
} from "../messaging/index.js";

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/**
 * Bundle returned by {@link tracker}. Wraps a topic + cursor-based
 * subscription with imperative `add` / `ack` helpers.
 */
export interface TrackerBundle<T> {
	/**
	 * The underlying topic. Either freshly minted on the hub at
	 * `topicName` (default {@link DEFERRED_TOPIC}) or reused if the topic
	 * already exists.
	 */
	readonly topic: TopicGraph<T>;
	/** Cursor-based subscription view over `topic.events`. */
	readonly subscription: SubscriptionGraph<T>;
	/**
	 * Items beyond the current cursor — i.e. the deferred queue's
	 * "pending" head. Reactive `Node<readonly T[]>`.
	 */
	readonly pending: Node<readonly T[]>;
	/** Current cursor position (number of items already acked). */
	readonly cursor: Node<number>;
	/**
	 * Reactive total count of items added since construction (matches the
	 * topic's retained-events length until the topic's retention cap is
	 * reached).
	 */
	readonly total: Node<number>;
	/** Append an item to the deferred queue. */
	add(item: T): void;
	/**
	 * Advance the cursor past `n` items (default 1). Acks the next batch
	 * of pending items; subsequent reads of `pending` exclude them.
	 */
	ack(n?: number): void;
	/**
	 * Pull-and-ack at most `limit` items in one shot. Returns the items
	 * + the new cursor position (matches `subscription.pullAndAck`).
	 */
	pullAndAck(limit?: number): { items: readonly T[]; cursor: number };
}

// ---------------------------------------------------------------------------
// tracker()
// ---------------------------------------------------------------------------

/**
 * Options for {@link tracker}.
 */
export interface TrackerOpts {
	/**
	 * Messaging hub. The tracker creates / reuses a topic on this hub
	 * named `topicName` (default {@link DEFERRED_TOPIC}).
	 */
	readonly hub: MessagingHubGraph;
	/**
	 * Topic name on the hub. Default {@link DEFERRED_TOPIC}. Override to
	 * use a non-deferred topic (e.g. a custom domain queue).
	 */
	readonly topicName?: string;
	/**
	 * Subscription graph name. Default `"tracker"`. Multiple trackers on
	 * the same hub topic must use distinct names.
	 */
	readonly name?: string;
	/**
	 * Initial cursor. Forwarded to the underlying subscription. See
	 * {@link SubscriptionOptions.from}.
	 */
	readonly from?: "now" | "retained" | number;
}

/**
 * Mints a tracker bundle over a hub topic.
 *
 * @example
 * ```ts
 * import { messagingHub, tracker } from "@graphrefly/graphrefly-ts";
 *
 * const hub = messagingHub("hub");
 * const issues = tracker<{ summary: string }>({ hub });
 *
 * issues.add({ summary: "investigate flaky test" });
 * issues.add({ summary: "follow up on auth refactor" });
 *
 * // Subscribe to the pending queue (for a dashboard, watcher, etc.)
 * issues.pending.subscribe((msgs) => { ... });
 *
 * // Imperative pull + ack
 * const next = issues.pullAndAck(1);
 * console.log(next.items[0]?.summary);
 * ```
 *
 * @category patterns
 */
export function tracker<T>(opts: TrackerOpts): TrackerBundle<T> {
	const { hub, topicName, name, from } = opts;
	const effectiveTopicName = topicName ?? DEFERRED_TOPIC;
	const effectiveName = name ?? "tracker";

	// Reuse existing topic on the hub or lazy-create.
	const topicGraph = hub.topic<T>(effectiveTopicName);

	// Cursor-based subscription. The subscription is owned by the tracker
	// (not mounted on the hub) — multiple trackers can share the topic with
	// independent cursors.
	const sub: SubscriptionGraph<T> = subscription<T>(effectiveName, topicGraph, {
		...(from != null && { from }),
	});

	// `total` derives from topic.events.length. Use a derived node owned by
	// the subscription for a self-contained surface. `keepAlive: true` so
	// `total.cache` stays current even without external subscribers.
	const total = sub.derived<number>(
		"tracker-total",
		[topicGraph.events],
		(data, ctx) => {
			const b0 = data[0];
			const arr =
				b0 != null && b0.length > 0
					? (b0.at(-1) as readonly T[])
					: ((ctx.prevData[0] as readonly T[] | undefined) ?? []);
			return [arr.length];
		},
		{ keepAlive: true },
	);

	return {
		topic: topicGraph,
		subscription: sub,
		pending: sub.available,
		cursor: sub.cursor,
		total,
		add: (item) => topicGraph.publish(item),
		ack: (n) => sub.ack(n ?? 1),
		pullAndAck: (limit) => sub.pullAndAck(limit),
	};
}

/**
 * Lazy per-topic state hub (roadmap §3.2) — lightweight last-value broadcasts.
 *
 * Each topic is a sentinel `node<unknown>()` with push-on-subscribe replay of
 * the most recent published value (no push until the first `publish`). For
 * Pulsar-inspired retained message logs,
 * cursor-based subscriptions, and job-queue semantics, use `messagingHub()` in
 * `utils/messaging` — built on `TopicGraph` / `SubscriptionGraph` with
 * retention policies, absolute cursor tracking, and per-subscriber state.
 *
 * Presentation layer (base/composition). Moved from pure-ts during cleave A3
 * (no substrate core/graph dependency on pubsub found).
 */

import { batch, type Node, node, TEARDOWN, wallClockNs } from "@graphrefly/pure-ts/core";
import {
	type PubSubChange,
	type PubSubChangePayload,
	type ReactiveLogBundle,
	reactiveLog,
} from "@graphrefly/pure-ts/extra";

// ── Backend interface ─────────────────────────────────────────────────────

/**
 * Storage contract for {@link pubsub} — registry only.
 *
 * Tracks the set of topic names plus a monotonic `version` counter that
 * advances on topic create/remove. Does NOT own per-topic message storage —
 * per-topic cached last values live in the topic nodes themselves (sentinel
 * until the first publish).
 *
 * For distributed / persistent per-topic storage, use `messagingHub()` in
 * `utils/messaging`, which composes `TopicGraph` under a lazy registry.
 *
 * @category base
 */
export interface PubSubBackend {
	/** Monotonic counter; advances on topic create/remove. */
	readonly version: number;
	readonly topicCount: number;
	hasTopic(name: string): boolean;
	topicNames(): IterableIterator<string>;
	/** Records topic creation. Returns `true` if newly added (advances `version`). */
	createTopic(name: string): boolean;
	/** Records topic removal. Returns `true` if it existed (advances `version`). */
	removeTopic(name: string): boolean;
}

/**
 * Default in-memory registry backend.
 *
 * @category base
 */
export class NativePubSubBackend implements PubSubBackend {
	private _version = 0;
	private readonly _topics = new Set<string>();

	get version(): number {
		return this._version;
	}

	get topicCount(): number {
		return this._topics.size;
	}

	hasTopic(name: string): boolean {
		return this._topics.has(name);
	}

	topicNames(): IterableIterator<string> {
		return this._topics.values();
	}

	createTopic(name: string): boolean {
		if (this._topics.has(name)) return false;
		this._topics.add(name);
		this._version += 1;
		return true;
	}

	removeTopic(name: string): boolean {
		const had = this._topics.delete(name);
		if (had) this._version += 1;
		return had;
	}
}

// ── Hub ───────────────────────────────────────────────────────────────────

export type PubSubHubOptions = {
	/**
	 * Storage backend. Defaults to `NativePubSubBackend`. Pluggable for audit /
	 * monitoring / mirror-to-external-broker use cases.
	 */
	backend?: PubSubBackend;
	/**
	 * DS-14 / DS14R2 — opt-in delta companion. When set, the hub appends a
	 * typed {@link PubSubChange} record in the **same batch frame** as the
	 * topic emission / teardown (same-wave consistency — subscribers reading
	 * both a topic and `mutationLog` never see torn state).
	 *
	 * Records the locked `PubSubChange` verbs that apply to this last-value
	 * hub: `publish` (per `publish` / `publishMany`) and `remove` (per
	 * `removeTopic`). The `ack` verb is a cursor concern of `messagingHub()`
	 * and does not apply here. **Note:** the locked `publish` payload carries
	 * `value` only (no topic name) — callers needing per-topic delta
	 * correlation should embed identity in the value or use `messagingHub()`.
	 *
	 * `true` = defaults; object form forwards `maxSize` / `name` to the inner
	 * `reactiveLog`.
	 */
	mutationLog?: true | { maxSize?: number; name?: string };
};

/**
 * Lazy per-topic state hub. Topics are single-value sentinel nodes
 * with push-on-subscribe replay of the most recent publish.
 *
 * @category base
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
	/** Publishes a value to the topic (lazily creating the topic if missing). */
	publish(name: string, value: unknown): void;
	/**
	 * Bulk publish — single outer batch for all entries. No-op if empty.
	 *
	 * **Iterable consumption (F6):** `entries` is consumed once (single-pass).
	 * Pass an array or `Set` for multi-shot callers. Iteration happens INSIDE
	 * the batch frame — if the iterator throws mid-way, the batch is discarded
	 * and NO publishes are visible to subscribers (all-or-nothing within one
	 * call).
	 */
	publishMany(entries: Iterable<[string, unknown]>): void;
	/** Removes a topic; sends `TEARDOWN` to its node. Returns `true` if it existed. */
	removeTopic(name: string): boolean;
	/** Checks topic existence without creating. O(1). */
	has(name: string): boolean;
	/** Number of topics currently registered. O(1). */
	readonly size: number;
	/** Iterator over topic names. */
	topicNames(): IterableIterator<string>;
	/**
	 * DS14R2 — present iff `mutationLog` was configured. Append-only log of
	 * `publish` / `remove` deltas, same-wave-consistent with topic emissions.
	 */
	readonly mutationLog?: ReactiveLogBundle<PubSubChange>;
}

/**
 * Creates a lazy per-topic state hub.
 *
 * @param options - Optional pluggable `backend` (defaults to `NativePubSubBackend`).
 * @returns Hub with lazy `topic()` / `publish()` / `publishMany()` / `removeTopic()` /
 *   `has()` / `size` / `topicNames()`.
 *
 * @remarks
 * **Scope:** Each topic is a sentinel node — retains only the last published
 * value (no push-on-subscribe before the first publish). For Pulsar-inspired
 * retention + cursor reading, use `messagingHub()` in `utils/messaging`.
 *
 * **`removeTopic`:** Sends `TEARDOWN` to the topic node; all subscribers receive
 * the TEARDOWN message. Subsequent `publish(name, value)` silently recreates the
 * topic with a fresh node — existing subscribers to the old node do NOT reconnect.
 *
 * @example
 * ```ts
 * import { pubsub } from "@graphrefly/graphrefly";
 *
 * const hub = pubsub();
 * const t = hub.topic("events");
 * t.subscribe((msgs) => console.log(msgs));
 * hub.publish("events", { ok: true });
 * hub.publishMany([["events", 1], ["status", "ready"]]);
 * ```
 *
 * @category base
 */
export function pubsub(options: PubSubHubOptions = {}): PubSubHub {
	const { backend: userBackend, mutationLog: mutLogOpt } = options;
	const backend: PubSubBackend = userBackend ?? new NativePubSubBackend();
	const nodes = new Map<string, Node<unknown>>();

	// ── DS14R2 — mutation log companion ──────────────────────────────────────
	const mutLog: ReactiveLogBundle<PubSubChange> | undefined = mutLogOpt
		? reactiveLog<PubSubChange>(undefined, {
				name: mutLogOpt === true ? "pubsub.mutationLog" : (mutLogOpt.name ?? "pubsub.mutationLog"),
				maxSize: mutLogOpt === true ? undefined : mutLogOpt.maxSize,
			})
		: undefined;
	let mutVersion = 0;
	function recordChange(change: PubSubChangePayload): void {
		if (!mutLog) return;
		mutLog.append({
			structure: "pubsub",
			version: ++mutVersion,
			t_ns: wallClockNs(),
			lifecycle: "data",
			change,
		});
	}

	function ensureTopic(name: string): Node<unknown> {
		let n = nodes.get(name);
		if (n === undefined) {
			n = node<unknown>({ describeKind: "state" });
			nodes.set(name, n);
			backend.createTopic(name);
		}
		return n;
	}

	return {
		topic(name: string): Node<unknown> {
			return ensureTopic(name);
		},

		publish(name: string, value: unknown): void {
			if (!mutLog) {
				ensureTopic(name).emit(value);
				return;
			}
			// Same-wave: topic emit + change record in one batch frame.
			batch(() => {
				ensureTopic(name).emit(value);
				recordChange({ kind: "publish", value });
			});
		},

		publishMany(entries: Iterable<[string, unknown]>): void {
			batch(() => {
				for (const [name, value] of entries) {
					ensureTopic(name).emit(value);
					recordChange({ kind: "publish", value });
				}
			});
		},

		removeTopic(name: string): boolean {
			const n = nodes.get(name);
			if (n === undefined) return false;
			nodes.delete(name);
			backend.removeTopic(name);
			if (!mutLog) {
				n.down([[TEARDOWN]]);
				return true;
			}
			batch(() => {
				// QA P3: record BEFORE TEARDOWN. A subscriber wired to both a
				// topic and `mutationLog` that self-detaches on TEARDOWN would
				// otherwise miss the `remove` delta (same-wave consistency).
				recordChange({ kind: "remove", name });
				n.down([[TEARDOWN]]);
			});
			return true;
		},

		has(name: string): boolean {
			return backend.hasTopic(name);
		},

		get size(): number {
			return backend.topicCount;
		},

		topicNames(): IterableIterator<string> {
			return backend.topicNames();
		},

		mutationLog: mutLog,
	};
}

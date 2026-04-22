/**
 * Messaging patterns (roadmap §4.2).
 *
 * Pulsar-inspired messaging features modeled as graph factories:
 * - `topic()` for append-only topic streams
 * - `subscription()` for cursor-based consumers
 * - `jobQueue()` for queue claim/ack flow
 */

import { batch, COMPLETE, DATA, derived, type Node, node, state } from "../core/index.js";
import { reactiveList } from "../extra/reactive-list.js";
import { reactiveLog } from "../extra/reactive-log.js";
import { reactiveMap } from "../extra/reactive-map.js";
import { Graph, type GraphOptions } from "../graph/index.js";

const DEFAULT_MAX_PER_PUMP = 2_147_483_647;

function requireNonNegativeInt(value: number, label: string): number {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

import { domainMeta, keepalive } from "./_internal.js";

function messagingMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("messaging", kind, extra);
}

export type TopicOptions = {
	graph?: GraphOptions;
	retainedLimit?: number;
};

export class TopicGraph<T> extends Graph {
	private readonly _log;
	readonly events: Node<readonly T[]>;
	/**
	 * Most recently published value, or `null` when the topic has no entries
	 * yet. Spec §5.12 reserves `undefined` as the protocol-internal "never
	 * sent DATA" sentinel — `null` is the idiomatic "empty / no value" signal
	 * for domain nodes. F7.
	 *
	 * **Caveat when `T` itself includes `null`** (e.g., `topic<number | null>`):
	 * `latest === null` is ambiguous — it could mean "no publish yet" OR "a
	 * `null` value was published". Use {@link hasLatest} to disambiguate, or
	 * observe {@link events} directly and track length yourself.
	 */
	readonly latest: Node<T | null>;
	/**
	 * Reactive `true` once the topic has at least one published entry.
	 * Disambiguates "`null` never published" from "`null` was published" when
	 * `T` includes `null`.
	 */
	readonly hasLatest: Node<boolean>;

	constructor(name: string, opts: TopicOptions = {}) {
		super(name, opts.graph);
		this._log = reactiveLog<T>([], { name: "events", maxSize: opts.retainedLimit });
		this.events = this._log.entries;
		this.add(this.events, { name: "events" });
		this.latest = derived<T | null>(
			[this.events],
			([snapshot]) => {
				const entries = snapshot as readonly T[];
				return entries.length === 0 ? null : (entries[entries.length - 1] as T);
			},
			{
				name: "latest",
				describeKind: "derived",
				meta: messagingMeta("topic_latest"),
			},
		);
		this.add(this.latest, { name: "latest" });
		this.addDisposer(keepalive(this.latest));

		this.hasLatest = derived<boolean>(
			[this.events],
			([snapshot]) => (snapshot as readonly T[]).length > 0,
			{
				name: "hasLatest",
				describeKind: "derived",
				meta: messagingMeta("topic_has_latest"),
			},
		);
		this.add(this.hasLatest, { name: "hasLatest" });
		this.addDisposer(keepalive(this.hasLatest));

		// D1(a): on teardown, propagate COMPLETE on `events` so downstream
		// derived chains (including any externally-held SubscriptionGraph
		// sources) see the termination via their `terminalDeps` and can stop
		// serving stale caches. Tier-3 terminal per spec §2.2.
		this.addDisposer(() => {
			this.events.down([[COMPLETE]]);
		});
		// P9: release any memoized tail/slice view keepalives held by the log.
		// TopicGraph itself doesn't call log.tail/slice, but plugins may have
		// attached views via `_log` — defensive.
		this.addDisposer(() => this._log.disposeAllViews());
	}

	publish(value: T): void {
		this._log.append(value);
	}

	retained(): readonly T[] {
		return this.events.cache as readonly T[];
	}
}

export type SubscriptionOptions = {
	graph?: GraphOptions;
	cursor?: number;
};

export class SubscriptionGraph<T> extends Graph {
	readonly source: Node<readonly T[]>;
	readonly cursor: Node<number>;
	readonly available: Node<readonly T[]>;
	/**
	 * Reference to the upstream topic graph. Intentionally NOT mounted
	 * under this subscription: a subscription is a VIEW over an
	 * externally-owned topic. Double-mounting (e.g. hub-owned topic +
	 * sub-mount here) would make either-side teardown leave the other
	 * holding a dead reference. Node-level `derived([topicEvents], …)`
	 * still wires the data dependency across graph boundaries. D1(e).
	 */
	readonly topic: TopicGraph<T>;

	constructor(name: string, topicGraph: TopicGraph<T>, opts: SubscriptionOptions = {}) {
		super(name, opts.graph);
		const initialCursor = requireNonNegativeInt(opts.cursor ?? 0, "subscription cursor");
		this.topic = topicGraph;
		const topicEvents = topicGraph.events;
		this.source = derived([topicEvents], ([snapshot]) => snapshot as readonly T[], {
			name: "source",
			describeKind: "derived",
			meta: messagingMeta("subscription_source"),
			initial: topicEvents.cache as readonly T[],
		});
		this.add(this.source, { name: "source" });
		this.cursor = state(initialCursor, {
			name: "cursor",
			describeKind: "state",
			meta: messagingMeta("subscription_cursor"),
		});
		this.add(this.cursor, { name: "cursor" });
		this.available = derived(
			[this.source, this.cursor],
			([sourceSnapshot, cursor]) => {
				const entries = sourceSnapshot as readonly T[];
				const start = Math.max(0, Math.trunc((cursor as number) ?? 0));
				return entries.slice(start);
			},
			{
				name: "available",
				describeKind: "derived",
				meta: messagingMeta("subscription_available"),
				initial: [],
			},
		);
		this.add(this.available, { name: "available" });
		// No `connect("topic::events", "source")` — topic is not mounted here.
		// The node-level dep `derived([topicEvents], …)` above is the live wire.
		this.addDisposer(keepalive(this.source));
		this.addDisposer(keepalive(this.available));
	}

	ack(count?: number): number {
		const available = this.available.cache as readonly T[];
		const requested =
			count === undefined
				? available.length
				: requireNonNegativeInt(count, "subscription ack count");
		const step = Math.min(requested, available.length);
		if (step <= 0) return this.cursor.cache as number;
		const next = (this.cursor.cache as number) + step;
		// F8: use emit() so the pipeline auto-prefixes DIRTY, runs equals
		// substitution, and produces a proper two-phase wave (the raw
		// `down([[DATA, next]])` path bypassed those contracts).
		this.cursor.emit(next);
		return next;
	}

	pull(limit?: number, opts: { ack?: boolean } = {}): readonly T[] {
		const available = this.available.cache as readonly T[];
		const max =
			limit === undefined
				? available.length
				: requireNonNegativeInt(limit, "subscription pull limit");
		const out = available.slice(0, max);
		if (opts.ack && out.length > 0) this.ack(out.length);
		return out;
	}
}

export type JobState = "queued" | "inflight";

export type JobEnvelope<T> = {
	id: string;
	payload: T;
	attempts: number;
	metadata: Readonly<Record<string, unknown>>;
	state: JobState;
};

export type JobQueueOptions = {
	graph?: GraphOptions;
};

export class JobQueueGraph<T> extends Graph {
	private readonly _pending;
	private readonly _jobs;
	private _seq = 0;
	readonly pending: Node<readonly string[]>;
	readonly jobs: Node<ReadonlyMap<string, JobEnvelope<T>>>;
	readonly depth: Node<number>;

	constructor(name: string, opts: JobQueueOptions = {}) {
		super(name, opts.graph);
		this._pending = reactiveList<string>([], { name: "pending" });
		this._jobs = reactiveMap<string, JobEnvelope<T>>({ name: "jobs" });
		this.pending = this._pending.items;
		this.jobs = this._jobs.entries;
		this.add(this.pending, { name: "pending" });
		this.add(this.jobs, { name: "jobs" });
		this.depth = derived([this.pending], ([snapshot]) => (snapshot as readonly string[]).length, {
			name: "depth",
			describeKind: "derived",
			meta: messagingMeta("queue_depth"),
			initial: 0,
		});
		this.add(this.depth, { name: "depth" });
		this.addDisposer(keepalive(this.depth));
	}

	enqueue(payload: T, opts: { id?: string; metadata?: Record<string, unknown> } = {}): string {
		const id = opts.id ?? `${this.name}-${++this._seq}`;
		if (this._jobs.get(id) !== undefined) {
			throw new Error(`jobQueue("${this.name}"): duplicate job id "${id}"`);
		}
		const job: JobEnvelope<T> = {
			id,
			payload,
			attempts: 0,
			metadata: Object.freeze({ ...(opts.metadata ?? {}) }),
			state: "queued",
		};
		this._jobs.set(id, job);
		this._pending.append(id);
		return id;
	}

	claim(limit = 1): readonly JobEnvelope<T>[] {
		const max = requireNonNegativeInt(limit, "job queue claim limit");
		if (max === 0) return [];
		const out: JobEnvelope<T>[] = [];
		while (out.length < max) {
			const ids = this.pending.cache as readonly string[];
			if (ids.length === 0) break;
			const id = this._pending.pop(0);
			const job = this._jobs.get(id);
			if (!job || job.state !== "queued") continue;
			const inflight: JobEnvelope<T> = {
				...job,
				state: "inflight",
				attempts: job.attempts + 1,
			};
			this._jobs.set(id, inflight);
			out.push(inflight);
		}
		return out;
	}

	ack(id: string): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		this._jobs.delete(id);
		return true;
	}

	nack(id: string, opts: { requeue?: boolean } = {}): boolean {
		const job = this._jobs.get(id);
		if (!job || job.state !== "inflight") return false;
		if (opts.requeue ?? true) {
			this._jobs.set(id, { ...job, state: "queued" });
			this._pending.append(id);
			return true;
		}
		this._jobs.delete(id);
		return true;
	}
}

export type JobFlowOptions = {
	graph?: GraphOptions;
	stages?: readonly string[];
	maxPerPump?: number;
};

export class JobFlowGraph<T> extends Graph {
	private readonly _stageNames: readonly string[];
	private readonly _queues = new Map<string, JobQueueGraph<T>>();
	private readonly _completed;
	readonly completed: Node<readonly JobEnvelope<T>[]>;
	readonly completedCount: Node<number>;

	constructor(name: string, opts: JobFlowOptions = {}) {
		super(name, opts.graph);
		const stages = (opts.stages ?? ["incoming", "processing", "done"]).map((v) => v.trim());
		if (stages.length < 2) {
			throw new Error(`jobFlow("${name}"): requires at least 2 stages`);
		}
		const unique = new Set(stages);
		if (unique.size !== stages.length) {
			throw new Error(`jobFlow("${name}"): stage names must be unique`);
		}
		this._stageNames = Object.freeze([...stages]);
		for (const stage of this._stageNames) {
			const q = jobQueue<T>(`${name}-${stage}`);
			this._queues.set(stage, q);
			this.mount(stage, q);
		}
		this._completed = reactiveLog<JobEnvelope<T>>([], { name: "completed" });
		this.completed = this._completed.entries;
		this.add(this.completed, { name: "completed" });
		this.completedCount = derived(
			[this.completed],
			([snapshot]) => (snapshot as readonly JobEnvelope<T>[]).length,
			{
				name: "completedCount",
				describeKind: "derived",
				meta: messagingMeta("job_flow_completed_count"),
				initial: 0,
			},
		);
		this.add(this.completedCount, { name: "completedCount" });
		this.addDisposer(keepalive(this.completedCount));

		const maxPerPump = Math.max(
			1,
			requireNonNegativeInt(opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP, "job flow maxPerPump"),
		);
		for (let i = 0; i < this._stageNames.length; i += 1) {
			const stage = this._stageNames[i] as string;
			const current = this.queue(stage);
			const next =
				i + 1 < this._stageNames.length ? this.queue(this._stageNames[i + 1] as string) : null;
			const pump = node<unknown>(
				[current.pending],
				() => {
					let moved = 0;
					while (moved < maxPerPump) {
						const claim = current.claim(1);
						if (claim.length === 0) break;
						const job = claim[0] as JobEnvelope<T>;
						if (!job) break;
						if (next) {
							next.enqueue(job.payload, {
								metadata: {
									...job.metadata,
									job_flow_from: stage,
								},
							});
						} else {
							this._completed.append(job);
						}
						current.ack(job.id);
						moved += 1;
					}
				},
				{
					name: `pump_${stage}`,
					describeKind: "effect",
					meta: messagingMeta("job_flow_pump"),
				},
			);
			this.add(pump, { name: `pump_${stage}` });
			this.addDisposer(keepalive(pump));
		}
	}

	stages(): readonly string[] {
		return this._stageNames;
	}

	queue(stage: string): JobQueueGraph<T> {
		const q = this._queues.get(stage);
		if (!q) throw new Error(`jobFlow("${this.name}"): unknown stage "${stage}"`);
		return q;
	}

	enqueue(payload: T, opts: { id?: string; metadata?: Record<string, unknown> } = {}): string {
		return this.queue(this._stageNames[0] as string).enqueue(payload, opts);
	}

	retainedCompleted(): readonly JobEnvelope<T>[] {
		return this.completed.cache as readonly JobEnvelope<T>[];
	}
}

export type TopicBridgeOptions<TIn, TOut> = {
	graph?: GraphOptions;
	cursor?: number;
	maxPerPump?: number;
	map?: (value: TIn) => TOut | undefined;
};

export class TopicBridgeGraph<TIn, TOut = TIn> extends Graph {
	private readonly _sourceSub;
	private readonly _target;
	readonly bridgedCount: Node<number>;

	constructor(
		name: string,
		sourceTopic: TopicGraph<TIn>,
		targetTopic: TopicGraph<TOut>,
		opts: TopicBridgeOptions<TIn, TOut> = {},
	) {
		super(name, opts.graph);
		this._sourceSub = subscription<TIn>(`${name}-subscription`, sourceTopic, {
			cursor: opts.cursor,
		});
		this._target = targetTopic;
		this.mount("subscription", this._sourceSub);
		this.bridgedCount = state(0, {
			name: "bridgedCount",
			describeKind: "state",
			meta: messagingMeta("topic_bridge_count"),
		});
		this.add(this.bridgedCount, { name: "bridgedCount" });

		const maxPerPump = Math.max(
			1,
			requireNonNegativeInt(opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP, "topic bridge maxPerPump"),
		);
		const mapValue = opts.map ?? ((value: TIn) => value as unknown as TOut);
		const pump = node<unknown>(
			[this._sourceSub.available],
			() => {
				const available = this._sourceSub.pull(maxPerPump, { ack: true });
				if (available.length === 0) return;
				let bridged = 0;
				for (const value of available) {
					const mapped = mapValue(value as TIn);
					if (mapped === undefined) continue;
					this._target.publish(mapped);
					bridged += 1;
				}
				if (bridged > 0) {
					const current = this.bridgedCount.cache as number;
					this.bridgedCount.down([[DATA, current + bridged]]);
				}
			},
			{
				name: "pump",
				describeKind: "effect",
				meta: messagingMeta("topic_bridge_pump"),
			},
		);
		this.add(pump, { name: "pump" });
		this.addDisposer(keepalive(pump));
	}
}

// ── MessagingHubGraph ─────────────────────────────────────────────────────

export type MessagingHubOptions = {
	graph?: GraphOptions;
	/**
	 * Default `TopicOptions` applied to every topic created via `topic(name)`
	 * without explicit options. Per-call opts override. Default: `{}`
	 * (unbounded retention per topic unless `retainedLimit` is set per call).
	 */
	defaultTopicOptions?: TopicOptions;
};

/**
 * Lazy Pulsar-inspired topic registry. Manages a named set of {@link TopicGraph}
 * instances with retention + cursor semantics. Topics are created on first
 * access; `removeTopic(name)` unmounts and tears down via {@link Graph.remove}.
 *
 * **Relationship to `pubsub()` in `src/extra/pubsub.ts`:** `pubsub` is a
 * lightweight last-value state hub (no retention, no cursors). `MessagingHubGraph`
 * is the full messaging hub — retained message logs, cursor-based subscriptions,
 * and pattern-layer lifecycle management.
 *
 * @category patterns
 */
export class MessagingHubGraph extends Graph {
	private readonly _topics = new Map<string, TopicGraph<unknown>>();
	private _version = 0;
	private readonly _defaultTopicOptions: TopicOptions;

	constructor(name: string, opts: MessagingHubOptions = {}) {
		super(name, opts.graph);
		// P8: shallow-copy caller-provided defaults so post-construction
		// mutations by the caller don't leak into every future `topic()` call.
		this._defaultTopicOptions = { ...(opts.defaultTopicOptions ?? {}) };
	}

	/** Monotonic counter advancing on topic create/remove. */
	get version(): number {
		return this._version;
	}

	/** Number of topics currently in the hub. */
	get size(): number {
		return this._topics.size;
	}

	/** Checks topic existence without creating. */
	has(name: string): boolean {
		return this._topics.has(name);
	}

	/** Iterator over topic names. */
	topicNames(): IterableIterator<string> {
		return this._topics.keys();
	}

	/**
	 * Returns the {@link TopicGraph} for `name`, creating lazily on first call.
	 * Subsequent calls with the same name return the same instance (options on
	 * repeat calls are ignored — the topic is already configured).
	 */
	topic<T = unknown>(name: string, opts?: TopicOptions): TopicGraph<T> {
		let t = this._topics.get(name) as TopicGraph<T> | undefined;
		if (t === undefined) {
			const effective: TopicOptions = { ...this._defaultTopicOptions, ...(opts ?? {}) };
			t = new TopicGraph<T>(name, effective);
			this._topics.set(name, t as TopicGraph<unknown>);
			this.mount(name, t);
			this._version += 1;
		}
		return t;
	}

	/**
	 * Publishes a value to the topic, lazily creating it on first publish.
	 *
	 * **Late-subscriber caveat:** the topic is created lazily, so subscribers
	 * that attach AFTER a publish only see the retained window (governed by
	 * `retainedLimit` on `TopicOptions` / `defaultTopicOptions`). If
	 * `retainedLimit === 0` is set explicitly, early publishes are
	 * effectively dropped — prefer an unset `retainedLimit` (unbounded
	 * retention) or subscribe before publishing when late-subscribers matter.
	 */
	publish<T = unknown>(name: string, value: T): void {
		this.topic<T>(name).publish(value);
	}

	/**
	 * Bulk publish — issues all publishes inside one outer batch. New topics
	 * are created on demand. No-op if `entries` yields nothing.
	 *
	 * **Iterable consumption (F6):** `entries` is consumed once (single-pass)
	 * INSIDE the batch frame. If the iterator throws mid-way, the batch is
	 * discarded and NO publishes are visible to subscribers (all-or-nothing).
	 * Pass an array or `Set` for multi-shot callers.
	 */
	publishMany(entries: Iterable<[string, unknown]>): void {
		// P2: iterate inside batch — no `[...entries]` materialization so large
		// / infinite iterables don't OOM, and iterator throws are contained.
		batch(() => {
			for (const [name, value] of entries) {
				this.topic(name).publish(value);
			}
		});
	}

	/**
	 * Creates a {@link SubscriptionGraph} over a named topic. The topic is
	 * lazily created if missing. Subscription lifecycle is owned by the caller —
	 * the hub does NOT mount the subscription.
	 *
	 * @param subName - Local name for the subscription graph.
	 * @param topicName - Hub topic to subscribe to.
	 * @param opts - `SubscriptionOptions` (initial cursor, etc.).
	 */
	subscribe<T = unknown>(
		subName: string,
		topicName: string,
		opts?: SubscriptionOptions,
	): SubscriptionGraph<T> {
		const t = this.topic<T>(topicName);
		return new SubscriptionGraph<T>(subName, t, opts);
	}

	/**
	 * Unmounts and tears down the topic's graph. Returns `true` if the topic
	 * existed. Subscribers receive `TEARDOWN` via {@link Graph.remove}.
	 */
	removeTopic(name: string): boolean {
		if (!this._topics.has(name)) return false;
		// P1 / P3: Graph.remove first — if it throws, `_topics` must NOT still
		// hold the broken half-disposed topic (otherwise the next
		// `hub.topic(name)` returns the corrupted reference). Wrap in
		// try/finally so `_topics` / `_version` converge to a consistent state
		// regardless of whether `remove` throws. Mount-orphan safety is
		// preserved by removing before deleting.
		try {
			this.remove(name); // unmounts, drops edges, tears down
		} finally {
			this._topics.delete(name);
			this._version += 1;
		}
		return true;
	}
}

/**
 * Creates a Pulsar-inspired topic graph (append-only retained stream + latest value).
 */
export function topic<T>(name: string, opts?: TopicOptions): TopicGraph<T> {
	return new TopicGraph<T>(name, opts);
}

/**
 * Creates a lazy Pulsar-inspired messaging hub. Topics are created on first access
 * via `hub.topic(name)`; `hub.publish(name, value)` shortcuts through the registry.
 *
 * @example
 * ```ts
 * import { messagingHub } from "@graphrefly/graphrefly-ts";
 *
 * const hub = messagingHub("main", { defaultTopicOptions: { retainedLimit: 256 } });
 * hub.publish("orders", { id: 1 });
 * hub.publishMany([["shipments", { id: 1 }], ["orders", { id: 2 }]]);
 * const sub = hub.subscribe("orders-worker", "orders", { cursor: 0 });
 * ```
 */
export function messagingHub(name: string, opts?: MessagingHubOptions): MessagingHubGraph {
	return new MessagingHubGraph(name, opts);
}

/**
 * Creates a cursor-based subscription graph over a topic.
 */
export function subscription<T>(
	name: string,
	topicGraph: TopicGraph<T>,
	opts?: SubscriptionOptions,
): SubscriptionGraph<T> {
	return new SubscriptionGraph<T>(name, topicGraph, opts);
}

/**
 * Creates a Pulsar-inspired job queue graph with claim/ack/nack workflow.
 */
export function jobQueue<T>(name: string, opts?: JobQueueOptions): JobQueueGraph<T> {
	return new JobQueueGraph<T>(name, opts);
}

/**
 * Creates an autonomous multi-stage queue chain graph.
 */
export function jobFlow<T>(name: string, opts?: JobFlowOptions): JobFlowGraph<T> {
	return new JobFlowGraph<T>(name, opts);
}

/**
 * Creates an autonomous cursor-based topic relay graph.
 */
export function topicBridge<TIn, TOut = TIn>(
	name: string,
	sourceTopic: TopicGraph<TIn>,
	targetTopic: TopicGraph<TOut>,
	opts?: TopicBridgeOptions<TIn, TOut>,
): TopicBridgeGraph<TIn, TOut> {
	return new TopicBridgeGraph<TIn, TOut>(name, sourceTopic, targetTopic, opts);
}

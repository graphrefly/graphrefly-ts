/**
 * Messaging patterns (roadmap §4.2).
 *
 * Pulsar-inspired messaging primitives modeled as graph factories:
 * - `topic()` for append-only topic streams with a retained window.
 * - `subscription()` for cursor-based consumers.
 * - `topicBridge()` for autonomous topic-to-topic relay.
 * - `messagingHub()` for a lazy topic registry.
 *
 * Job queue / job flow primitives live in `patterns/job-queue` — they are a
 * distinct domain that happens to share reactive-log / reactive-map
 * infrastructure with topics.
 */

import { batch, COMPLETE, DATA, derived, type Node, state } from "../../core/index.js";
import { node } from "../../core/node.js";
import { domainMeta } from "../../extra/meta.js";
import { lightMutation } from "../../extra/mutation/index.js";
import { reactiveLog } from "../../extra/reactive-log.js";
import { keepalive } from "../../extra/sources.js";
import { Graph, type GraphOptions } from "../../graph/index.js";

const DEFAULT_MAX_PER_PUMP = 256;

function requireNonNegativeInt(value: number, label: string): number {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return value;
}

function messagingMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("messaging", kind, extra);
}

export type TopicOptions = {
	graph?: GraphOptions;
	/** Bounded retention; default 1024 per cross-cutting policy (Audit 2/4). */
	retainedLimit?: number;
};

const DEFAULT_TOPIC_RETAINED_LIMIT = 1024;

export class TopicGraph<T> extends Graph {
	private readonly _log;
	private readonly _publishImpl: (value: T) => void;
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
		this._log = reactiveLog<T>([], {
			name: "events",
			maxSize: opts.retainedLimit ?? DEFAULT_TOPIC_RETAINED_LIMIT,
		});
		// Activate withLatest companions (Audit 1) so `topic.lastValue` /
		// `topic.hasLatest` shorthands resolve to the same Nodes consumers
		// would access via `events`.
		this._log.withLatest();
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

		// Tier 8 / COMPOSITION-GUIDE §35: route publish through `lightMutation`
		// for centralized freeze + re-throw semantics. No audit log surface
		// (per Tier 8 γ-0): the topic's `events` log already records every
		// successful publish, so a separate audit Node would be redundant.
		// `freeze: false` because topic payloads can be large and per-publish
		// cost matters on hot paths.
		this._publishImpl = lightMutation<[T], void, never>(
			(value): void => {
				this._log.append(value);
			},
			{ freeze: false },
		);
	}

	publish(value: T): void {
		// SENTINEL alignment (Wave B.1 Unit 11 lock): `undefined` is the
		// protocol-level "never sent DATA" sentinel — refusing it here
		// preserves `lastValue: Node<T | undefined>` semantics.
		if (value === undefined) {
			throw new TypeError(
				`TopicGraph "${this.name}": publish(undefined) is not allowed (spec §5.12 SENTINEL).`,
			);
		}
		this._publishImpl(value);
	}

	/**
	 * Wire one or more append-log storage tiers (Audit 4). Each tier receives
	 * appended events per wave; rollback honors the wave-as-transaction model.
	 *
	 * Named `attachEventStorage` (not `attachStorage`) to avoid colliding with
	 * the inherited {@link Graph.attachSnapshotStorage} which takes the
	 * snapshot-based `StorageTier[]` shape.
	 *
	 * @returns Disposer.
	 */
	attachEventStorage(
		tiers: readonly import("../../extra/storage-tiers.js").AppendLogStorageTier<T>[],
	): () => void {
		return this._log.attachStorage(tiers);
	}

	retained(): readonly T[] {
		return this.events.cache as readonly T[];
	}

	/** Internal log bundle — used by TopicBridgeGraph for `attach`. */
	get _logBundle() {
		return this._log;
	}
}

export type SubscriptionOptions = {
	graph?: GraphOptions;
	/**
	 * Starting cursor position.
	 * @deprecated Use `from` instead.
	 */
	cursor?: number;
	/**
	 * Starting position for the subscription.
	 * - `"retained"` (default) — cursor starts at 0; consumer sees all retained history.
	 * - `"now"` — cursor starts at current topic length; consumer ignores history.
	 * - `number` — explicit cursor position.
	 */
	from?: "now" | "retained" | number;
	/**
	 * When this signal node emits DATA, the subscription auto-advances cursor
	 * to current `available.length`. Useful for "ack everything when X happens"
	 * patterns. The reactive edge `advanceOn → cursor` is visible in `explain()`.
	 */
	advanceOn?: Node<unknown>;
};

/** Result of {@link SubscriptionGraph.pullAndAck}. */
export type PullAndAckResult<T> = {
	items: readonly T[];
	cursor: number;
};

export class SubscriptionGraph<T> extends Graph {
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

	private _disposed = false;
	private readonly _ackImpl: (count: number | undefined) => number;
	private readonly _pullAndAckImpl: (limit: number | undefined) => PullAndAckResult<T>;

	constructor(name: string, topicGraph: TopicGraph<T>, opts: SubscriptionOptions = {}) {
		super(name, opts.graph);
		this.topic = topicGraph;

		// Resolve initial cursor from `from` option, falling back to legacy `cursor` option.
		let initialCursor: number;
		if (opts.from !== undefined) {
			if (opts.from === "retained") {
				initialCursor = 0;
			} else if (opts.from === "now") {
				// §28 sanctioned factory-time boundary read.
				initialCursor = (topicGraph.events.cache as readonly T[]).length;
			} else {
				initialCursor = requireNonNegativeInt(opts.from, "subscription from");
			}
		} else {
			initialCursor = requireNonNegativeInt(opts.cursor ?? 0, "subscription cursor");
		}

		this.cursor = state(initialCursor, {
			name: "cursor",
			describeKind: "state",
			meta: messagingMeta("subscription_cursor"),
		});
		this.add(this.cursor, { name: "cursor" });

		// B.1 Unit 12 lock: `available` depends directly on topic.events + cursor
		// via `view({ kind: "fromCursor" })`. No `source` passthrough node —
		// describe shows `topic::events → available` (cross-graph edge) and
		// `cursor → available` (local edge). One fewer node per subscription.
		this.available = topicGraph._logBundle.view({ kind: "fromCursor", cursor: this.cursor });
		this.add(this.available, { name: "available" });
		this.addDisposer(keepalive(this.available));

		// Optional reactive auto-advance: when `advanceOn` emits a NEW DATA
		// (after construction), cursor advances by `available.length` atomically.
		// Edge visible in describe: advancePump depends on advanceOn.
		// `_advanceInitialized` guards against the initial push-on-subscribe fire
		// that would advance cursor before the user has a chance to read.
		if (opts.advanceOn !== undefined) {
			const advanceOn = opts.advanceOn;
			let advanceInitialized = false;
			const advancePump = node<unknown>(
				[advanceOn],
				() => {
					// Skip the initial push-on-subscribe wave.
					if (!advanceInitialized) {
						advanceInitialized = true;
						return;
					}
					if (this._disposed) return;
					const avail = this.available.cache as readonly T[];
					if (avail.length === 0) return;
					const next = (this.cursor.cache as number) + avail.length;
					this.cursor.emit(next);
				},
				{
					name: "advancePump",
					describeKind: "effect",
					meta: messagingMeta("subscription_advance_pump"),
				},
			);
			this.add(advancePump, { name: "advancePump" });
			this.addDisposer(keepalive(advancePump));
		}

		// Tier 8 / COMPOSITION-GUIDE §35: route ack + pullAndAck through
		// `lightMutation` for centralized freeze + re-throw semantics. No audit
		// log surface (per Tier 8 γ-0): the cursor's own emission stream already
		// records every advance, so a separate audit Node would be redundant.
		// `freeze: false` because count/limit are simple numbers; freezing is
		// pointless overhead. Disposed-checks stay outside the wrapper so a
		// no-op call doesn't unnecessarily run the wrapper.
		this._ackImpl = lightMutation<[number | undefined], number, never>(
			(count): number => {
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
			},
			{ freeze: false },
		);

		this._pullAndAckImpl = lightMutation<[number | undefined], PullAndAckResult<T>, never>(
			(limit): PullAndAckResult<T> => {
				const available = this.available.cache as readonly T[];
				const max =
					limit === undefined
						? available.length
						: requireNonNegativeInt(limit, "subscription pullAndAck limit");
				const items = available.slice(0, max);
				if (items.length === 0) return { items, cursor: this.cursor.cache as number };
				const next = (this.cursor.cache as number) + items.length;
				this.cursor.emit(next);
				return { items, cursor: next };
			},
			{ freeze: false },
		);
	}

	ack(count?: number): number {
		if (this._disposed) return this.cursor.cache as number;
		return this._ackImpl(count);
	}

	pull(limit?: number): readonly T[] {
		if (this._disposed) return [];
		const available = this.available.cache as readonly T[];
		const max =
			limit === undefined
				? available.length
				: requireNonNegativeInt(limit, "subscription pull limit");
		return available.slice(0, max);
	}

	/**
	 * Atomic pull-and-acknowledge. Returns `{ items, cursor }` where `cursor`
	 * is the new cursor position after advancing. Under single-threaded JS the
	 * snapshot and advance are atomic; PY callers use a per-subscription Lock.
	 *
	 * Replaces `pull(limit, { ack: true })`.
	 */
	pullAndAck(limit?: number): PullAndAckResult<T> {
		if (this._disposed) return { items: [], cursor: this.cursor.cache as number };
		return this._pullAndAckImpl(limit);
	}

	/**
	 * Release internal subscriptions and mark the subscription torn-down.
	 * Subsequent `pull`, `pullAndAck`, `ack` return empty / current cursor.
	 * Emits COMPLETE on `cursor` so derived consumers (e.g. `available`) see
	 * the termination signal. Also drains `addDisposer` callbacks (including
	 * the `keepalive(advancePump)` subscription) so no keepalive leak occurs.
	 */
	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		this.cursor.down([[COMPLETE]]);
		// m4: drain addDisposer callbacks to release the keepalive subscription.
		this.destroy();
	}
}

export type TopicBridgeOptions<TIn, TOut> = {
	graph?: GraphOptions;
	cursor?: number;
	maxPerPump?: number;
	/**
	 * Optional transform/filter applied to each item before republishing.
	 *
	 * **At-most-once with silent drop:** when `map` returns `undefined`, the
	 * input is consumed from the source cursor but NOT republished. Filtered
	 * items are not retained for retry. If you need filter-with-retry
	 * semantics, do the filtering in a downstream subscription on the bridged
	 * output rather than in the `map` function.
	 */
	map?: (value: TIn) => TOut | undefined;
};

export class TopicBridgeGraph<TIn, TOut = TIn> extends Graph {
	private readonly _sourceSub;
	readonly bridgedCount: Node<number>;
	/**
	 * Emits each mapped batch as DATA — gives downstream observers a reactive
	 * stream of bridged values. Also the link target for `target._log.attach`.
	 */
	readonly output: Node<readonly TOut[]>;

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
		this.mount("subscription", this._sourceSub);

		const maxPerPump = Math.max(
			1,
			requireNonNegativeInt(opts.maxPerPump ?? DEFAULT_MAX_PER_PUMP, "topic bridge maxPerPump"),
		);
		const mapValue = opts.map ?? ((value: TIn) => value as unknown as TOut);

		// Reactive output node: derives a mapped batch from `available`.
		// §24 compliant — output is a real derived edge, visible in describe.
		// Replaces imperative publish loop. Items where mapValue returns undefined
		// are filtered out (opt-out / filter).
		this.output = derived<readonly TOut[]>(
			[this._sourceSub.available],
			([avail]) => {
				const arr = avail as readonly TIn[];
				const outBatch: TOut[] = [];
				const take = Math.min(arr.length, maxPerPump);
				for (let i = 0; i < take; i++) {
					const mapped = mapValue(arr[i] as TIn);
					if (mapped !== undefined) outBatch.push(mapped);
				}
				return outBatch;
			},
			{
				name: "output",
				describeKind: "derived",
				meta: messagingMeta("topic_bridge_output", { targetRef: targetTopic.name }),
				initial: [],
			},
		);
		this.add(this.output, { name: "output" });
		this.addDisposer(keepalive(this.output));

		// bridgedCount: state node accumulating total bridged items.
		// Updated by ackPump after each batch — edge visible via ackPump dep on output.
		this.bridgedCount = state<number>(0, {
			name: "bridgedCount",
			describeKind: "state",
			meta: messagingMeta("topic_bridge_count"),
		});
		this.add(this.bridgedCount, { name: "bridgedCount" });
		this.addDisposer(keepalive(this.bridgedCount));

		// ackPump: effect that advances the subscription cursor and updates
		// bridgedCount after each batch. Runs after `output` settles.
		// Captures refs to `this.output`, `this._sourceSub`, `this.bridgedCount`
		// to avoid `this` inside the fn body.
		const outputRef = this.output;
		const subRef = this._sourceSub;
		const countRef = this.bridgedCount;
		const ackPump = node<unknown>(
			[outputRef],
			() => {
				const outBatch = outputRef.cache as readonly TOut[];
				if (outBatch.length === 0) return;
				const availLen = (subRef.available.cache as readonly TIn[]).length;
				const toAck = Math.min(availLen, maxPerPump);
				if (toAck > 0) {
					subRef.ack(toAck);
					const prev = (countRef.cache as number) ?? 0;
					countRef.emit(prev + outBatch.length);
				}
			},
			{
				name: "ackPump",
				describeKind: "effect",
				meta: messagingMeta("topic_bridge_ack_pump"),
			},
		);
		this.add(ackPump, { name: "ackPump" });
		this.addDisposer(keepalive(ackPump));

		// Wire output into target topic's log reactively.
		// _attachArrayToLog subscribes to output and publishes each item to targetTopic.
		// Teardown: disposer runs before mount teardown.
		const detach = _attachArrayToLog(this.output, targetTopic);
		this.addDisposer(detach);
	}
}

/**
 * Attaches each element of an array-valued Node to a TopicGraph's log.
 * Every DATA emission on `source` appends all items in the array to `targetTopic`.
 * Returns a disposer.
 */
function _attachArrayToLog<T>(source: Node<readonly T[]>, targetTopic: TopicGraph<T>): () => void {
	return source.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] !== DATA) continue;
			const arr = m[1] as readonly T[];
			if (arr.length === 0) continue;
			batch(() => {
				for (const v of arr) targetTopic.publish(v);
			});
		}
	});
}

// ── TopicRegistry ─────────────────────────────────────────────────────────

/**
 * Private pure data structure managing a named set of {@link TopicGraph}
 * instances. Extracted from {@link MessagingHubGraph} for separation of
 * concerns (B.2 Unit 14 lock: D — split into TopicRegistry + facade).
 *
 * Reusable if other domain consumers (e.g. cqrs.eventLogs) want a shared
 * topic registry later.
 *
 * @internal
 */
export class TopicRegistry {
	private readonly _map = new Map<string, TopicGraph<unknown>>();
	/** Reactive monotonic version counter. Advances on topic create/remove. */
	readonly version: Node<number>;

	constructor(versionNode: Node<number>) {
		this.version = versionNode;
	}

	get size(): number {
		return this._map.size;
	}

	has(name: string): boolean {
		return this._map.has(name);
	}

	get<T>(name: string): TopicGraph<T> | undefined {
		return this._map.get(name) as TopicGraph<T> | undefined;
	}

	set<T>(name: string, t: TopicGraph<T>): void {
		this._map.set(name, t as TopicGraph<unknown>);
	}

	delete(name: string): boolean {
		return this._map.delete(name);
	}

	keys(): IterableIterator<string> {
		return this._map.keys();
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
 * Internally delegates to {@link TopicRegistry} for topic map management
 * (B.2 Unit 14 lock: D facade split).
 *
 * **Relationship to `pubsub()` in `src/extra/pubsub.ts`:** `pubsub` is a
 * lightweight last-value state hub (no retention, no cursors). `MessagingHubGraph`
 * is the full messaging hub — retained message logs, cursor-based subscriptions,
 * and pattern-layer lifecycle management.
 *
 * @category patterns
 */
export class MessagingHubGraph extends Graph {
	private readonly _registry: TopicRegistry;
	/** Reactive monotonic version counter — advances on topic create/remove. */
	readonly version: Node<number>;
	private readonly _defaultTopicOptions: TopicOptions;
	private readonly _removeTopicImpl: (name: string) => void;

	constructor(name: string, opts: MessagingHubOptions = {}) {
		super(name, opts.graph);
		// B.2 Unit 14 lock: promote _version → version: Node<number>.
		const versionNode = state(0, {
			name: "version",
			describeKind: "state",
			meta: messagingMeta("hub_version"),
		});
		this.add(versionNode, { name: "version" });
		this.version = versionNode;
		this._registry = new TopicRegistry(versionNode);
		// P8: shallow-copy caller-provided defaults so post-construction
		// mutations by the caller don't leak into every future `topic()` call.
		this._defaultTopicOptions = { ...(opts.defaultTopicOptions ?? {}) };

		// Tier 8 / COMPOSITION-GUIDE §35: route the registry-delete branch of
		// `removeTopic` through `lightMutation` for centralized re-throw
		// semantics. No audit log surface (per Tier 8 γ-0).
		// `freeze: false` because the only arg is a string name (freeze pointless).
		// **Closure-state caveat (γ-4):** the inner `try/finally` mutates
		// `_registry` (a `Map`) and emits the version bump. lightMutation has no
		// `batch()` frame, so reactive emissions are NOT rolled back on throw —
		// and even if it did, `Map.delete` on closure state is invisible to the
		// batch and can't be unwound. The pre-existing try/finally on
		// `Graph.remove` is what guarantees registry/version converge to a
		// consistent state when `remove()` throws; `lightMutation` adds nothing
		// to that contract beyond the re-throw.
		this._removeTopicImpl = lightMutation<[string], void, never>(
			(topicName): void => {
				try {
					this.remove(topicName); // unmounts, drops edges, tears down
				} finally {
					this._registry.delete(topicName);
					const cur = (this.version.cache as number) ?? 0;
					this.version.emit(cur + 1);
				}
			},
			{ freeze: false },
		);
	}

	/** Number of topics currently in the hub. */
	get size(): number {
		return this._registry.size;
	}

	/** Checks topic existence without creating. */
	has(name: string): boolean {
		return this._registry.has(name);
	}

	/** Iterator over topic names. */
	topicNames(): IterableIterator<string> {
		return this._registry.keys();
	}

	/**
	 * Returns the {@link TopicGraph} for `name`, creating lazily on first call.
	 * Subsequent calls with the same name return the same instance (options on
	 * repeat calls are ignored — the topic is already configured).
	 */
	topic<T = unknown>(name: string, opts?: TopicOptions): TopicGraph<T> {
		let t = this._registry.get<T>(name);
		if (t === undefined) {
			const effective: TopicOptions = { ...this._defaultTopicOptions, ...(opts ?? {}) };
			t = new TopicGraph<T>(name, effective);
			this._registry.set(name, t);
			this.mount(name, t);
			const cur = (this.version.cache as number) ?? 0;
			this.version.emit(cur + 1);
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
	 *
	 * **Closure-state caveat:** the registry mutation (`_registry.delete`) and
	 * version bump happen in a `try/finally`, so registry/version converge to
	 * a consistent state even when {@link Graph.remove} throws. `lightMutation`
	 * does not roll back this mutation on throw — `Map.delete` on closure
	 * state is invisible to any batch frame. The pre-existing try/finally is
	 * load-bearing for that invariant.
	 */
	removeTopic(name: string): boolean {
		if (!this._registry.has(name)) return false;
		// P1 / P3: Graph.remove first — if it throws, `_registry` must NOT still
		// hold the broken half-disposed topic (otherwise the next
		// `hub.topic(name)` returns the corrupted reference). The `try/finally`
		// inside `_removeTopicImpl`'s action body preserves that invariant.
		this._removeTopicImpl(name);
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
 * import { messagingHub } from "@graphrefly/graphrefly/patterns/messaging";
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
 * Creates an autonomous cursor-based topic relay graph.
 *
 * When `opts.map` is provided, items where `map` returns `undefined` are
 * consumed from the source cursor but NOT republished (at-most-once with
 * silent drop). For filter-with-retry semantics, apply the filter in a
 * downstream subscription on the bridge's `output` node instead.
 */
export function topicBridge<TIn, TOut = TIn>(
	name: string,
	sourceTopic: TopicGraph<TIn>,
	targetTopic: TopicGraph<TOut>,
	opts?: TopicBridgeOptions<TIn, TOut>,
): TopicBridgeGraph<TIn, TOut> {
	return new TopicBridgeGraph<TIn, TOut>(name, sourceTopic, targetTopic, opts);
}

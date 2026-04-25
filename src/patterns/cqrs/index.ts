/**
 * CQRS patterns (roadmap §4.5).
 *
 * Composition layer over reactiveLog (3.2), pipeline/sagas (4.1), event bus (4.2),
 * projections (4.3). Guards (1.5) enforce command/query boundary.
 *
 * - `cqrs(name, opts?)` → `CqrsGraph` — top-level factory
 * - `CqrsGraph.command(name, handler)` — write-only node; guard rejects `observe`
 * - `CqrsGraph.event(name)` — backed by `reactiveLog`; append-only
 * - `CqrsGraph.projection(name, events, reducer, initial)` — read-only derived; guard rejects `write`
 * - `CqrsGraph.saga(name, events, handler)` — event-driven side effects
 */

import { batch } from "../../core/batch.js";
import { wallClockNs } from "../../core/clock.js";
import { policy } from "../../core/guard.js";
import { DATA, derived, type Node, node, state } from "../../core/index.js";
import { type ReactiveLogBundle, reactiveLog } from "../../extra/reactive-log.js";
import type { AppendLogStorageTier } from "../../extra/storage-tiers.js";
import { Graph, type GraphOptions } from "../../graph/index.js";
import {
	CommandHandlerError,
	DuplicateRegistrationError,
	OptimisticConcurrencyError,
	UnknownCommandError,
} from "../_internal/errors.js";
import {
	type BaseAuditRecord,
	createAuditLog,
	registerCursor,
	registerCursorMap,
} from "../_internal/imperative-audit.js";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Commands: write + signal allowed, observe denied. */
const COMMAND_GUARD = policy((allow, deny) => {
	allow("write");
	allow("signal");
	deny("observe");
});

/** Projections: observe + signal allowed, write denied. */
const PROJECTION_GUARD = policy((allow, deny) => {
	allow("observe");
	allow("signal");
	deny("write");
});

/** Events: observe + signal allowed, write denied (appended internally). */
const EVENT_GUARD = policy((allow, deny) => {
	allow("observe");
	allow("signal");
	deny("write");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { domainMeta, keepalive } from "../_internal/index.js";

function cqrsMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("cqrs", kind, extra);
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const k of Object.keys(value as Record<string, unknown>)) {
		deepFreeze((value as Record<string, unknown>)[k]);
	}
	return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

/**
 * Immutable envelope for events emitted by command handlers.
 *
 * **Wave C.1 Unit 17 (locked 2026-04-24):** Extended ES standard fields —
 * `aggregateId` / `aggregateVersion` for per-aggregate streams; correlation /
 * causation IDs for distributed tracing; `metadata` for free-form context.
 * Optional `handlerVersion` (Audit 5) traces which handler version produced
 * the event.
 *
 * `seq` is a per-graph monotonic counter that provides stable ordering when
 * multiple events share the same `timestampNs` (same wall-clock tick).
 */
export type CqrsEvent<T = unknown> = {
	type: string;
	payload: T;
	/** Wall-clock nanoseconds (via `wallClockNs()`). */
	timestampNs: number;
	/** Monotonic sequence within this CqrsGraph instance. */
	seq: number;
	/** Aggregate identifier (per-aggregate streams). */
	aggregateId?: string;
	/** Per-aggregate monotonic version (set when `aggregateId` is provided). */
	aggregateVersion?: number;
	/** Distributed-trace correlation id. */
	correlationId?: string;
	/** Causation chain id (this event was caused by event `causationId`). */
	causationId?: string;
	/** Free-form metadata frozen at append. */
	metadata?: Readonly<Record<string, unknown>>;
	/** V0 identity of the event log node at append time (§6.0b). */
	v0?: { id: string; version: number };
	/** Handler version stamped on emit (Audit 5). */
	handlerVersion?: { id: string; version: string | number };
};

/** Compile-time event-map registry: `{ "orderPlaced": OrderPayload, ... }`. */
export type CqrsEventMap = Record<string, unknown>;

/** Recommended `keyOf` for CQRS event-store storage tiers (Audit 4). */
export const cqrsEventKeyOf = (e: CqrsEvent): string =>
	`${e.type}::${e.aggregateId ?? "__default__"}`;

// ── Audit records (Audit 2 cross-cutting) ────────────────────────────────

export interface DispatchRecord<T = unknown> extends BaseAuditRecord {
	readonly commandName: string;
	readonly payload: T;
	readonly status: "success" | "failed";
	readonly error?: unknown;
	readonly errorType?: string;
	/**
	 * Event names emitted by the handler.
	 * - `status: "success"`: events that persisted in the event log.
	 * - `status: "failed"`: events the handler ATTEMPTED to emit before throwing;
	 *   they were rolled back and did NOT persist. Documents the failed attempt's
	 *   intentions for debugging handler logic. The actual event log shows only
	 *   what's durable.
	 */
	readonly emittedEvents?: readonly string[];
}

export const dispatchKeyOf = <T>(r: DispatchRecord<T>): string => r.commandName;

export interface SagaInvocation<T = unknown> extends BaseAuditRecord {
	readonly eventType: string;
	readonly status: "success" | "failed";
	readonly error?: unknown;
	readonly errorType?: string;
	readonly aggregateId?: string;
	readonly event?: CqrsEvent<T>;
}

export const sagaInvocationKeyOf = <T>(i: SagaInvocation<T>): string => i.eventType;

/**
 * Saga registration result (M10) — a typed bundle replacing the prior
 * `Node<unknown>` return that side-attached `_saga` via an unsafe cast.
 *
 * `node` is the saga's effect node (subscribe to observe processing
 * activity). `invocations` is the per-event-type audit log; `audit` aliases
 * `invocations` (Audit 2 `.audit` duplication). `cursors` exposes the
 * per-event-type cursor state nodes for monitoring / testing.
 *
 * @category patterns
 */
export interface SagaController<T = unknown> {
	readonly node: Node<unknown>;
	readonly invocations: ReactiveLogBundle<SagaInvocation<T>>;
	readonly audit: ReactiveLogBundle<SagaInvocation<T>>;
	readonly cursors: { readonly [eventName: string]: Node<number> };
}

// ---------------------------------------------------------------------------
// Event store adapter
// ---------------------------------------------------------------------------

/**
 * Opaque replay cursor returned by `loadEvents`. Pass it back to
 * `loadEvents` to resume from the last position.
 */
export type EventStoreCursor = {
	readonly __brand?: "EventStoreCursor";
	[key: string]: unknown;
};

/**
 * Result of `loadEvents` — events plus an opaque cursor for resumption.
 */
export type LoadEventsResult = {
	events: CqrsEvent[];
	cursor: EventStoreCursor | undefined;
};

/**
 * Pluggable persistence for CQRS events.
 *
 * **`persist`:** Must be synchronous. Called from the dispatch path inside
 * `batch()`. Adapters that need async I/O should buffer internally and
 * expose a `flush()` method for explicit drain.
 */
export interface EventStoreAdapter {
	persist(event: CqrsEvent): void;
	/**
	 * Load persisted events. When `cursor` is provided, returns only events
	 * after that position. The returned `cursor` should be passed to the next
	 * `loadEvents` call for incremental replay.
	 */
	loadEvents(
		eventType: string,
		cursor?: EventStoreCursor,
	): LoadEventsResult | Promise<LoadEventsResult>;
	/** Optional explicit flush for adapters with async I/O. */
	flush?(): Promise<void>;
}

export class MemoryEventStore implements EventStoreAdapter {
	private readonly _store = new Map<string, CqrsEvent[]>();

	persist(event: CqrsEvent): void {
		let list = this._store.get(event.type);
		if (!list) {
			list = [];
			this._store.set(event.type, list);
		}
		list.push(event);
	}

	loadEvents(eventType: string, cursor?: EventStoreCursor): LoadEventsResult {
		const list = this._store.get(eventType) ?? [];
		const sinceTs = (cursor as { timestampNs?: number } | undefined)?.timestampNs;
		const sinceSeq = (cursor as { seq?: number } | undefined)?.seq;
		const events =
			sinceTs == null
				? [...list]
				: list.filter(
						(e) =>
							e.timestampNs > sinceTs || (e.timestampNs === sinceTs && e.seq > (sinceSeq ?? -1)),
					);
		const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
		return {
			events,
			cursor: lastEvent ? { timestampNs: lastEvent.timestampNs, seq: lastEvent.seq } : cursor,
		};
	}

	clear(): void {
		this._store.clear();
	}
}

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

export type CommandActions = {
	/** Append an event to a named event log (bypasses event guard). */
	emit: (eventName: string, payload: unknown) => void;
};

/**
 * Command handler receives the dispatch payload and actions to emit events.
 *
 * **Purity:** Handlers should not mutate the payload. Event emission via
 * `actions.emit()` is the only sanctioned side effect.
 */
export type CommandHandler<T = unknown> = (payload: T, actions: CommandActions) => void;

/**
 * Projection reducer folds events into a read model.
 *
 * **Purity contract:** Reducers MUST be pure — return a new state value
 * without mutating `state` or any event. The `state` parameter is the
 * original `initial` value on every invocation (full event-sourcing replay),
 * so mutation would corrupt future recomputations.
 */
export type ProjectionReducer<TState = unknown, TEvent = unknown> = (
	state: TState,
	events: readonly CqrsEvent<TEvent>[],
) => TState;

export type SagaHandler<T = unknown> = (event: CqrsEvent<T>) => void;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type CqrsOptions = {
	graph?: GraphOptions;
	/** Bounded retention for event streams; default 1024 (cross-cutting). */
	retainedLimit?: number;
	/** Freeze command payloads on dispatch (default `true`). */
	freezeCommandPayload?: boolean;
	/** Freeze event payloads on emit (default `true`). */
	freezeEventPayload?: boolean;
	/** LRU eviction threshold for per-aggregate streams (default 10_000). */
	maxAggregates?: number;
};

export type CommandRegistration<TPayload = unknown> = {
	handler: CommandHandler<TPayload>;
	emits?: readonly string[];
	handlerVersion?: { id: string; version: string | number };
};

export type DispatchOptions = {
	correlationId?: string;
	causationId?: string;
	metadata?: Record<string, unknown>;
	/**
	 * Optimistic-concurrency check: if set, dispatch verifies the aggregate
	 * (identified by `aggregateId`) is at this version. On mismatch, dispatch
	 * throws {@link OptimisticConcurrencyError} BEFORE the handler runs.
	 *
	 * Requires `aggregateId` to be set. Without it the check is a no-op.
	 */
	expectedAggregateVersion?: number;
	/**
	 * Aggregate this dispatch targets. Events emitted by the handler that
	 * also carry this `aggregateId` participate in per-aggregate versioning
	 * and LRU eviction (see {@link CqrsOptions.maxAggregates}). Events whose
	 * handler-supplied `aggregateId` differs from the dispatch's `aggregateId`
	 * are emitted untouched (their own `aggregateVersion` is computed from
	 * their own aggregate's stream).
	 */
	aggregateId?: string;
};

export type SagaOptions = {
	aggregateId?: string;
	errorPolicy?: "advance" | "hold";
	handlerVersion?: { id: string; version: string | number };
};

// ---------------------------------------------------------------------------
// CqrsGraph
// ---------------------------------------------------------------------------

type EventEntry = {
	log: ReturnType<typeof reactiveLog<CqrsEvent>>;
	node: Node<readonly CqrsEvent[]>;
};

/**
 * Eviction record emitted on `aggregateEvictions` when an aggregate's
 * per-aggregate stream is removed under `maxAggregates` LRU pressure. The
 * eviction does NOT delete events from the fan-in stream — only the
 * per-aggregate dedicated stream and its version counter.
 */
export interface AggregateEvictionRecord {
	readonly aggregateId: string;
	readonly type: string;
	readonly t_ns: number;
	/** The version count the aggregate reached before eviction (for diagnostics). */
	readonly lastVersion: number;
}

export class CqrsGraph<EM extends CqrsEventMap = Record<string, unknown>> extends Graph {
	/** Fan-in event streams (one per type, all aggregates merged). */
	private readonly _eventLogs = new Map<string, EventEntry>();
	/**
	 * Per-aggregate event streams: type → aggregateId → entry. Used for
	 * `event(type, aggregateId)` dual-form access and per-aggregate version
	 * tracking. Only populated when an event with `aggregateId` is emitted.
	 */
	private readonly _eventLogsByAggregate = new Map<string, Map<string, EventEntry>>();
	/** Per-aggregate version counters: `${type}::${aggregateId}` → current version. */
	private readonly _aggregateVersions = new Map<string, number>();
	/**
	 * LRU access order for `${type}::${aggregateId}`. Map insertion order
	 * tracks recency — `delete` + `set` on access moves to the end.
	 */
	private readonly _aggregateLru = new Map<string, true>();
	private readonly _commandRegs = new Map<
		string,
		{
			handler: CommandHandler<any>;
			emits?: readonly string[];
			handlerVersion?: { id: string; version: string | number };
		}
	>();
	private readonly _projections = new Set<string>();
	private readonly _sagas = new Set<string>();
	private readonly _keepaliveDisposers: Array<() => void> = [];
	private _eventStore: EventStoreAdapter | undefined;
	private _seq = 0;
	private readonly _retainedLimit: number;
	private readonly _freezeCommandPayload: boolean;
	private readonly _freezeEventPayload: boolean;
	private readonly _maxAggregates: number;
	private readonly _dispatchSeqCursor: Node<number>;
	/** Audit log of every command dispatch (Audit 2). */
	readonly dispatches: ReactiveLogBundle<DispatchRecord>;
	/** Alias for {@link CqrsGraph.dispatches} (Audit 2 `.audit` duplication). */
	readonly audit: ReactiveLogBundle<DispatchRecord>;
	/** Per-aggregate LRU eviction observability; secondary log to `dispatches`. */
	readonly aggregateEvictions: ReactiveLogBundle<AggregateEvictionRecord>;

	constructor(name: string, opts: CqrsOptions = {}) {
		super(name, opts.graph);
		this._retainedLimit = opts.retainedLimit ?? 1024;
		this._freezeCommandPayload = opts.freezeCommandPayload ?? true;
		this._freezeEventPayload = opts.freezeEventPayload ?? true;
		this._maxAggregates = opts.maxAggregates ?? 10_000;
		this.dispatches = createAuditLog<DispatchRecord>({
			name: "dispatches",
			retainedLimit: this._retainedLimit,
			graph: this,
		});
		this.audit = this.dispatches;
		this.aggregateEvictions = createAuditLog<AggregateEvictionRecord>({
			name: "aggregateEvictions",
			retainedLimit: this._retainedLimit,
			graph: this,
		});
		this._dispatchSeqCursor = registerCursor(this, "dispatch_seq", 0);
	}

	/**
	 * Read the current per-aggregate version (last emitted `aggregateVersion`
	 * for that `(type, aggregateId)` pair). Returns `0` if no events have been
	 * emitted yet for this aggregate. Useful for callers preparing
	 * {@link DispatchOptions.expectedAggregateVersion}.
	 */
	aggregateVersion(type: string, aggregateId: string): number {
		return this._aggregateVersions.get(`${type}::${aggregateId}`) ?? 0;
	}

	/** LRU touch — moves the key to the end of the access order. */
	private _touchAggregate(key: string): void {
		// Delete + set re-inserts at the end of Map iteration order.
		this._aggregateLru.delete(key);
		this._aggregateLru.set(key, true);
	}

	/**
	 * Evict the oldest aggregate streams (least-recently-touched) until the
	 * aggregate count is back within `_maxAggregates`. Emits one
	 * `AggregateEvictionRecord` per eviction. The fan-in stream is NOT touched
	 * — events stay in the type-level log; only the per-aggregate stream and
	 * version counter are removed.
	 */
	private _enforceAggregateLru(): void {
		while (this._aggregateLru.size > this._maxAggregates) {
			const oldest = this._aggregateLru.keys().next();
			if (oldest.done) break;
			const key = oldest.value;
			this._aggregateLru.delete(key);
			const sep = key.indexOf("::");
			if (sep < 0) continue;
			const type = key.slice(0, sep);
			const aggregateId = key.slice(sep + 2);
			const lastVersion = this._aggregateVersions.get(key) ?? 0;
			this._aggregateVersions.delete(key);
			const byType = this._eventLogsByAggregate.get(type);
			if (byType) {
				byType.delete(aggregateId);
				if (byType.size === 0) this._eventLogsByAggregate.delete(type);
			}
			this.aggregateEvictions.append({
				aggregateId,
				type,
				lastVersion,
				t_ns: wallClockNs(),
			});
		}
	}

	override destroy(): void {
		for (const dispose of this._keepaliveDisposers) dispose();
		this._keepaliveDisposers.length = 0;
		super.destroy();
	}

	/** Wire append-log storage tiers for ALL CQRS event streams (Audit 4). */
	attachEventStorage(tiers: readonly AppendLogStorageTier<CqrsEvent>[]): () => void {
		const disposers: Array<() => void> = [];
		// Register: any existing streams + future-registered (best-effort:
		// callers should attach after registering events).
		for (const entry of this._eventLogs.values()) {
			disposers.push(entry.log.attachStorage(tiers));
		}
		return () => {
			for (const d of disposers) d();
		};
	}

	private _bumpDispatchSeq(): number {
		const cur = (this._dispatchSeqCursor.cache as number | undefined) ?? 0;
		const next = cur + 1;
		this._dispatchSeqCursor.emit(next);
		return next;
	}

	// -- Events ---------------------------------------------------------------

	/**
	 * Register a named event stream backed by `reactiveLog`.
	 * Guard denies external `write` — only commands append internally.
	 */
	event(name: string): Node<readonly CqrsEvent[]>;
	event(name: string, aggregateId: string): Node<readonly CqrsEvent[]>;
	event(name: string, aggregateId?: string): Node<readonly CqrsEvent[]> {
		if (aggregateId !== undefined) {
			return this._ensureAggregateStream(name, aggregateId).node;
		}
		const existing = this._eventLogs.get(name);
		if (existing) return existing.node;

		// V0 versioning is attached at construction — post-hoc
		// `_applyVersioning` was deleted because it opened a re-entrance
		// window where a wave could observe `_versioning` transitioning from
		// `undefined` to a fresh state. Construction-time-only means the
		// flag is frozen at birth.
		const log = reactiveLog<CqrsEvent>([], {
			name,
			versioning: 0,
			maxSize: this._retainedLimit,
		});
		log.withLatest();
		const entries = log.entries;
		const guarded = derived<readonly CqrsEvent[]>(
			[entries],
			([snapshot]) => snapshot as readonly CqrsEvent[],
			{
				name,
				describeKind: "state",
				meta: cqrsMeta("event", { event_name: name }),
				guard: EVENT_GUARD,
				initial: entries.cache as readonly CqrsEvent[],
			},
		);
		this.add(guarded, { name: name });
		this._keepaliveDisposers.push(keepalive(guarded));
		this._eventLogs.set(name, { log, node: guarded });
		return guarded;
	}

	/**
	 * Get-or-create the per-aggregate event stream for `(type, aggregateId)`.
	 * Mounts the stream as a sibling node named `<type>_<aggregateId>` so it
	 * appears in `describe()`. LRU access is touched on every call.
	 */
	private _ensureAggregateStream(type: string, aggregateId: string): EventEntry {
		// Ensure the fan-in stream exists too (call sites usually expect both).
		if (!this._eventLogs.has(type)) this.event(type);

		let byType = this._eventLogsByAggregate.get(type);
		if (!byType) {
			byType = new Map();
			this._eventLogsByAggregate.set(type, byType);
		}
		const lruKey = `${type}::${aggregateId}`;
		this._touchAggregate(lruKey);
		const existing = byType.get(aggregateId);
		if (existing) return existing;

		const nodeName = `${type}_${aggregateId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
		const log = reactiveLog<CqrsEvent>([], {
			name: nodeName,
			versioning: 0,
			maxSize: this._retainedLimit,
		});
		log.withLatest();
		const entries = log.entries;
		const guarded = derived<readonly CqrsEvent[]>(
			[entries],
			([snapshot]) => snapshot as readonly CqrsEvent[],
			{
				name: nodeName,
				describeKind: "state",
				meta: cqrsMeta("event_aggregate", {
					event_name: type,
					aggregate_id: aggregateId,
				}),
				guard: EVENT_GUARD,
				initial: entries.cache as readonly CqrsEvent[],
			},
		);
		// Avoid name collisions if multiple aggregates have ids that sanitize
		// to the same node-name; suffix with a counter when necessary.
		let mountName = nodeName;
		let collisionIdx = 0;
		while (this.nameOf(this.resolveOptional(mountName) ?? guarded) === mountName) {
			collisionIdx += 1;
			mountName = `${nodeName}_${collisionIdx}`;
			if (this.resolveOptional(mountName) === undefined) break;
		}
		try {
			this.add(guarded, { name: mountName });
		} catch {
			// Name collision (likely with main type stream); skip mount —
			// per-aggregate stream still functions, just not graph-visible.
		}
		this._keepaliveDisposers.push(keepalive(guarded));
		const entry = { log, node: guarded };
		byType.set(aggregateId, entry);
		this._enforceAggregateLru();
		return entry;
	}

	/** Try `resolve(path)`; return `undefined` instead of throwing on missing. */
	private resolveOptional(path: string): Node | undefined {
		try {
			return this.resolve(path);
		} catch {
			return undefined;
		}
	}

	/** Internal: append to an event log, auto-registering if needed. */
	private _appendEvent(
		eventName: string,
		payload: unknown,
		extra?: {
			aggregateId?: string;
			correlationId?: string;
			causationId?: string;
			metadata?: Readonly<Record<string, unknown>>;
			handlerVersion?: { id: string; version: string | number };
		},
	): CqrsEvent {
		let entry = this._eventLogs.get(eventName);
		if (!entry) {
			this.event(eventName);
			entry = this._eventLogs.get(eventName)!;
		}
		if (entry.node.status === "completed" || entry.node.status === "errored") {
			throw new Error(
				`Cannot dispatch to terminated event stream "${eventName}" (status: ${entry.node.status}).`,
			);
		}

		// Per-aggregate version + stream wiring (D1).
		let aggregateVersion: number | undefined;
		let aggregateEntry: EventEntry | undefined;
		if (extra?.aggregateId !== undefined) {
			const lruKey = `${eventName}::${extra.aggregateId}`;
			aggregateVersion = (this._aggregateVersions.get(lruKey) ?? 0) + 1;
			this._aggregateVersions.set(lruKey, aggregateVersion);
			aggregateEntry = this._ensureAggregateStream(eventName, extra.aggregateId);
		}

		const nv = entry.log.entries.v;
		const frozenPayload = this._freezeEventPayload ? deepFreeze(payload) : payload;
		const evt: CqrsEvent = {
			type: eventName,
			payload: frozenPayload,
			timestampNs: wallClockNs(),
			seq: ++this._seq,
			...(extra?.aggregateId !== undefined ? { aggregateId: extra.aggregateId } : {}),
			...(aggregateVersion !== undefined ? { aggregateVersion } : {}),
			...(extra?.correlationId !== undefined ? { correlationId: extra.correlationId } : {}),
			...(extra?.causationId !== undefined ? { causationId: extra.causationId } : {}),
			...(extra?.metadata !== undefined ? { metadata: Object.freeze({ ...extra.metadata }) } : {}),
			...(extra?.handlerVersion !== undefined ? { handlerVersion: extra.handlerVersion } : {}),
			...(nv != null ? { v0: { id: nv.id, version: nv.version } } : {}),
		};
		// Append to fan-in stream (always) and per-aggregate stream (when set).
		entry.log.append(evt);
		if (aggregateEntry) {
			aggregateEntry.log.append(evt);
		}
		if (this._eventStore) {
			this._eventStore.persist(evt);
		}
		return evt;
	}

	// -- Commands -------------------------------------------------------------

	/**
	 * Register a command with its handler. Guard denies `observe` (write-only).
	 * Use `dispatch(name, payload)` to execute.
	 *
	 * The command node carries dynamic `meta.error` — a reactive companion
	 * that holds the last handler error (or `null` on success).
	 */
	command<T = unknown>(
		name: string,
		handlerOrReg: CommandHandler<T> | CommandRegistration<T>,
	): Node<T> {
		if (this._commandRegs.has(name)) {
			throw new DuplicateRegistrationError("command", name);
		}
		const reg: CommandRegistration<T> =
			typeof handlerOrReg === "function" ? { handler: handlerOrReg } : handlerOrReg;
		const cmdNode = state<T>(undefined as T, {
			name,
			describeKind: "state",
			meta: {
				...cqrsMeta("command", { command_name: name }),
				error: null,
			},
			guard: COMMAND_GUARD,
		});
		this.add(cmdNode, { name: name });
		this._commandRegs.set(name, {
			handler: reg.handler as CommandHandler<unknown>,
			...(reg.emits !== undefined ? { emits: reg.emits } : {}),
			...(reg.handlerVersion !== undefined ? { handlerVersion: reg.handlerVersion } : {}),
		});
		// Pre-register declared event streams so describe() shows them.
		if (reg.emits) {
			for (const e of reg.emits) {
				if (!this._eventLogs.has(e)) this.event(e);
			}
		}
		return cmdNode;
	}

	/**
	 * Execute a registered command. Wraps the entire dispatch in `batch()` so
	 * the command node DATA and all emitted events settle atomically.
	 *
	 * If the handler throws, `meta.error` on the command node is set to the
	 * error and the exception is re-thrown.
	 */
	dispatch<T = unknown>(commandName: string, payload: T, opts?: DispatchOptions): void {
		const reg = this._commandRegs.get(commandName);
		if (!reg) throw new UnknownCommandError(commandName);

		// D1: optimistic-concurrency check fires BEFORE the handler runs and
		// BEFORE the batch opens, so a stale-version dispatch is a clean
		// no-op (no audit record, no rollback). Only meaningful when both
		// aggregateId and expectedAggregateVersion are set; otherwise no-op.
		if (
			opts?.aggregateId !== undefined &&
			opts.expectedAggregateVersion !== undefined &&
			reg.emits !== undefined
		) {
			// Verify against ANY of the declared `emits` types — the dispatch's
			// aggregate version is per (type, aggregateId), but a single
			// dispatch may emit across multiple types. We check the FIRST
			// declared `emits` type that has a version recorded for this
			// aggregate; if none has a version, the aggregate is considered
			// at version 0.
			let observedVersion = 0;
			for (const t of reg.emits) {
				const v = this._aggregateVersions.get(`${t}::${opts.aggregateId}`);
				if (v !== undefined && v > observedVersion) observedVersion = v;
			}
			if (observedVersion !== opts.expectedAggregateVersion) {
				throw new OptimisticConcurrencyError(
					opts.aggregateId,
					opts.expectedAggregateVersion,
					observedVersion,
				);
			}
		}

		const cmdNode = this.resolve(commandName);
		const sealed = this._freezeCommandPayload ? deepFreeze(payload) : payload;
		const emittedEvents: string[] = [];
		const t_ns = wallClockNs();
		// M5: bump seq INSIDE the batch so a framework-level rollback discards
		// the cursor advance (cursor stays in sync with audit log).
		let seq = 0;
		let captured: unknown;
		let captureSet = false;
		try {
			batch(() => {
				seq = this._bumpDispatchSeq();
				cmdNode.emit(sealed, { internal: true });
				try {
					reg.handler(sealed, {
						emit: (eName, data) => {
							emittedEvents.push(eName);
							this._appendEvent(eName, data, {
								// D1: thread the dispatch's aggregateId through so events
								// participate in per-aggregate versioning. Handlers can
								// override per-emit by passing their own through a richer
								// emit signature (future extension).
								...(opts?.aggregateId !== undefined ? { aggregateId: opts.aggregateId } : {}),
								...(opts?.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
								...(opts?.causationId !== undefined ? { causationId: opts.causationId } : {}),
								...(opts?.metadata !== undefined
									? { metadata: Object.freeze({ ...opts.metadata }) }
									: {}),
								...(reg.handlerVersion !== undefined ? { handlerVersion: reg.handlerVersion } : {}),
							});
						},
					});
					cmdNode.meta.error.emit(null, { internal: true });
					this.dispatches.append({
						commandName,
						payload: sealed,
						status: "success",
						emittedEvents: [...emittedEvents],
						t_ns,
						seq,
						...(reg.handlerVersion !== undefined ? { handlerVersion: reg.handlerVersion } : {}),
					});
				} catch (err) {
					captured = err;
					captureSet = true;
					throw err;
				}
			});
		} catch (outerErr) {
			// C4: when `captureSet === false` the batch threw before the inner
			// try set `captured` (e.g. framework-level error from cmdNode.emit).
			// Re-throw the actual `outerErr` so the original error isn't masked
			// as `undefined`.
			if (captureSet) {
				// Emit error + failure record OUTSIDE the batch — in a fresh wave
				// after rollback so they persist.
				cmdNode.meta.error.emit(captured, { internal: true });
				const errorType = captured instanceof Error ? captured.name : typeof captured;
				const wrapped =
					captured instanceof CommandHandlerError
						? captured
						: new CommandHandlerError(commandName, captured);
				this.dispatches.append({
					commandName,
					payload: sealed,
					status: "failed",
					error: wrapped,
					errorType,
					emittedEvents: [...emittedEvents],
					t_ns,
					seq,
					...(reg.handlerVersion !== undefined ? { handlerVersion: reg.handlerVersion } : {}),
				});
			}
			throw captureSet ? captured : outerErr;
		}
	}

	// -- Projections ----------------------------------------------------------

	/**
	 * Register a read-only projection derived from event streams.
	 * Guard denies `write` — value is computed from events only.
	 *
	 * **Purity contract:** The `reducer` must be a pure function — it receives
	 * the original `initial` on every invocation (full event-sourcing replay).
	 * Never mutate `initial`; always return a new value.
	 */
	projection<TState>(
		name: string,
		eventNames: readonly string[],
		reducer: ProjectionReducer<TState>,
		initial: TState,
	): Node<TState> {
		const eventNodes = eventNames.map((eName) => {
			if (!this._eventLogs.has(eName)) this.event(eName);
			return this._eventLogs.get(eName)!.node;
		});

		const projNode = derived<TState>(
			eventNodes,
			(snapshots) => {
				const allEvents: CqrsEvent[] = [];
				for (const snapshot of snapshots) {
					const entries = snapshot as readonly CqrsEvent[];
					allEvents.push(...entries);
				}
				allEvents.sort((a, b) => a.timestampNs - b.timestampNs || a.seq - b.seq);
				return reducer(initial, allEvents);
			},
			{
				name,
				describeKind: "derived",
				meta: cqrsMeta("projection", { projection_name: name, source_events: eventNames }),
				guard: PROJECTION_GUARD,
				initial,
			},
		);

		this.add(projNode, { name: name });
		this._keepaliveDisposers.push(keepalive(projNode));
		this._projections.add(name);
		return projNode;
	}

	// -- Sagas ----------------------------------------------------------------

	/**
	 * Register an event-driven side effect. Runs handler for each **new** event
	 * from the specified streams (tracks last-processed entry count per stream).
	 *
	 * The saga node carries dynamic `meta.error` — a reactive companion that
	 * holds the last handler error (or `null` on success). Handler errors do
	 * not propagate out of the saga run (the event cursor still advances so
	 * the same entry is not delivered twice).
	 */
	saga<T = unknown>(
		name: string,
		eventNames: readonly string[],
		handler: SagaHandler<T>,
		opts: SagaOptions = {},
	): SagaController<T> {
		const eventNodes = eventNames.map((eName) => {
			if (!this._eventLogs.has(eName)) this.event(eName);
			return this._eventLogs.get(eName)!.node;
		});

		// Audit 2: per-event-type cursor state nodes (replaces closure Map).
		// Mount under `<saga>_cursor` (no `::` — that's the path separator).
		const cursors = registerCursorMap(this, `${name}_cursor`, eventNames as readonly string[], 0);
		// Audit 2: invocations log (companion + alias).
		const invocations = createAuditLog<SagaInvocation<T>>({
			name: `${name}_invocations`,
			retainedLimit: this._retainedLimit,
			graph: this,
		});
		const aggregateFilter = opts.aggregateId;
		const errorPolicy = opts.errorPolicy ?? "advance";

		// D2: subscribe-and-capture-mirror for cursor reads — avoid `.cache`
		// access from inside the saga node's fn. Each cursor mirrors into a
		// closure variable updated by an external subscription. Cursor writes
		// (`cursor.emit(advancedTo)`) and `invocations.append(...)` from inside
		// the fn are sanctioned effect-side-effects (saga's `describeKind:
		// "effect"`) — not §5.9 imperative-trigger violations.
		const latestCursors = new Map<string, number>();
		for (const eName of eventNames) {
			const cursor = cursors[eName]!;
			latestCursors.set(eName, (cursor.cache as number | undefined) ?? 0);
			const sub = cursor.subscribe((msgs) => {
				for (const m of msgs) if (m[0] === DATA) latestCursors.set(eName, m[1] as number);
			});
			this._keepaliveDisposers.push(sub);
		}

		const sagaRef: { n?: Node<unknown> } = {};
		const sagaNode = node(
			eventNodes,
			(snapshots, _actions) => {
				const errNode = sagaRef.n!.meta.error as Node<unknown>;
				for (let i = 0; i < snapshots.length; i++) {
					const batch = snapshots[i];
					if (batch == null || batch.length === 0) continue;
					const entries = batch.at(-1) as readonly CqrsEvent<T>[] | undefined;
					if (!entries) continue;
					const eName = eventNames[i] as string;
					const cursor = cursors[eName]!;
					const lastCount = latestCursors.get(eName) ?? 0;
					if (entries.length > lastCount) {
						const newEntries = entries.slice(lastCount);
						let advancedTo = lastCount;
						for (const entry of newEntries) {
							const ev = entry as CqrsEvent<T>;
							if (aggregateFilter !== undefined && ev.aggregateId !== aggregateFilter) {
								advancedTo += 1;
								continue;
							}
							try {
								handler(ev);
								errNode.emit(null, { internal: true });
								invocations.append({
									eventType: eName,
									status: "success",
									aggregateId: ev.aggregateId,
									event: ev,
									t_ns: wallClockNs(),
									...(opts.handlerVersion !== undefined
										? { handlerVersion: opts.handlerVersion }
										: {}),
								});
								advancedTo += 1;
							} catch (err) {
								errNode.emit(err, { internal: true });
								invocations.append({
									eventType: eName,
									status: "failed",
									error: err,
									errorType: err instanceof Error ? err.name : typeof err,
									aggregateId: ev.aggregateId,
									event: ev,
									t_ns: wallClockNs(),
									...(opts.handlerVersion !== undefined
										? { handlerVersion: opts.handlerVersion }
										: {}),
								});
								if (errorPolicy === "hold") break;
								// "advance" — skip past failure, keep going.
								advancedTo += 1;
							}
						}
						cursor.emit(advancedTo);
					}
				}
			},
			{
				name,
				describeKind: "effect",
				meta: {
					...cqrsMeta("saga", { saga_name: name, source_events: eventNames }),
					error: null,
				},
			},
		) as Node<unknown>;
		sagaRef.n = sagaNode;

		this.add(sagaNode, { name: name });
		this._keepaliveDisposers.push(keepalive(sagaNode));
		this._sagas.add(name);
		return {
			node: sagaNode,
			invocations,
			audit: invocations,
			cursors,
		};
	}

	// -- Event store ----------------------------------------------------------

	useEventStore(adapter: EventStoreAdapter): void {
		this._eventStore = adapter;
	}

	/**
	 * Replay persisted events through a reducer to rebuild a read model.
	 * Requires an event store adapter wired via `useEventStore()`.
	 */
	async rebuildProjection<TState>(
		eventNames: readonly string[],
		reducer: ProjectionReducer<TState>,
		initial: TState,
	): Promise<TState> {
		if (!this._eventStore) {
			throw new Error("No event store wired. Call useEventStore() first.");
		}
		const allEvents: CqrsEvent[] = [];
		for (const eName of eventNames) {
			const result = await this._eventStore.loadEvents(eName);
			allEvents.push(...result.events);
		}
		allEvents.sort((a, b) => a.timestampNs - b.timestampNs || a.seq - b.seq);
		return reducer(initial, allEvents);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a CQRS graph container.
 *
 * @example
 * ```ts
 * const app = cqrs("orders");
 * app.event("orderPlaced");
 * app.command("placeOrder", (payload, { emit }) => {
 *   emit("orderPlaced", { orderId: payload.id, amount: payload.amount });
 * });
 * app.projection("orderCount", ["orderPlaced"], (_s, events) => events.length, 0);
 * app.dispatch("placeOrder", { id: "1", amount: 100 });
 * ```
 */
export function cqrs<EM extends CqrsEventMap = Record<string, unknown>>(
	name: string,
	opts?: CqrsOptions,
): CqrsGraph<EM> {
	return new CqrsGraph<EM>(name, opts);
}

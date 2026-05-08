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

import { wallClockNs } from "../../core/clock.js";
import { policy } from "../../core/guard.js";
import { DATA, type Node, node, placeholderArgs } from "../../core/index.js";
import {
	type BaseAuditRecord,
	createAuditLog,
	mutate,
	registerCursor,
	registerCursorMap,
} from "../../extra/mutation/index.js";
import { type ReactiveLogBundle, reactiveLog } from "../../extra/reactive-log.js";
import type { AppendLogStorageTier } from "../../extra/storage-tiers.js";
import { Graph, type GraphOptions } from "../../graph/index.js";
import {
	CommandHandlerError,
	DuplicateRegistrationError,
	OptimisticConcurrencyError,
	RebuildError,
	UndeclaredEmitError,
	UnknownCommandError,
} from "../_internal/errors.js";

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

import { domainMeta } from "../../extra/meta.js";
import { keepalive } from "../../extra/sources.js";

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
	/** Action result. Tier 1.6.2 canonical enum (renamed from `status`). */
	readonly outcome: "success" | "failure";
	readonly error?: unknown;
	readonly errorType?: string;
	/**
	 * Event names emitted by the handler.
	 * - `outcome: "success"`: events that persisted in the event log.
	 * - `outcome: "failure"`: events the handler ATTEMPTED to emit before throwing;
	 *   they were rolled back and did NOT persist. Documents the failed attempt's
	 *   intentions for debugging handler logic. The actual event log shows only
	 *   what's durable.
	 */
	readonly emittedEvents?: readonly string[];
}

export const dispatchKeyOf = <T>(r: DispatchRecord<T>): string => r.commandName;

export interface SagaInvocation<T = unknown> extends BaseAuditRecord {
	readonly eventType: string;
	/** Action result. Tier 1.6.2 canonical enum (renamed from `status`). */
	readonly outcome: "success" | "failure";
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
 * without mutating `state` or any event.
 *
 * - In **`"replay"`** mode the `state` parameter is always the original
 *   `initial` value (full event-sourcing replay on every recompute).
 * - In **`"scan"`** mode the `state` parameter is the _previous_ output
 *   (incremental fold); `events` contains only the events appended since
 *   the last computation.
 */
export type ProjectionReducer<TState = unknown, TEvent = unknown> = (
	state: TState,
	events: readonly CqrsEvent<TEvent>[],
) => TState;

/**
 * Snapshot integration for {@link ProjectionOptions}.
 *
 * `load` is called once at projection construction and the returned value
 * seeds the initial state. `save` (optional) is called after each reducer
 * run, debounced by `saveDebounceMs` (default 1000 ms) and capped by
 * `saveEvery` (default 1000 events).
 */
export type ProjectionSnapshotOpts<TState> = {
	/** Load a previously-saved state. `undefined` → start from `initial`. */
	load: () => TState | undefined | Promise<TState | undefined>;
	/** Persist the current state. Called after reducer; may be async. */
	save?: (state: TState) => void | Promise<void>;
	/**
	 * Debounce window (ms) before `save` fires after the last event. Default 1000.
	 */
	saveDebounceMs?: number;
	/**
	 * Force a save after every Nth state change regardless of debounce.
	 * Default 1000. Both knobs compose: save fires at whichever condition is
	 * met first.
	 */
	saveEvery?: number;
};

/**
 * Options for {@link CqrsGraph.projection}.
 *
 * **Wave C.3 Unit 21 (locked 2026-04-24):**
 * - `mode: "scan"` (default) — incremental fold; `"replay"` — full replay
 *   each wave.
 * - `snapshot` — load/save integration for cold-start + auto-checkpoint.
 * - `freezeInputs` (default `true`) — freeze event arrays before passing
 *   to reducer (purity enforcement).
 * - `rebuild()` / `reset()` on the returned {@link ProjectionController}.
 *
 * @category patterns
 */
export type ProjectionOptions<TState> = {
	name: string;
	events: readonly string[];
	reducer: ProjectionReducer<TState>;
	initial: TState;
	/**
	 * Fold strategy. Default `"scan"` (incremental). `"replay"` = full replay.
	 *
	 * **Scan-mode ordering caveat:** scan-mode assumes monotonic per-stream
	 * arrival order. When multiple event streams are merged for a projection,
	 * events arriving with a `timestampNs` earlier than the current sort cursor
	 * are skipped from the incremental sweep. This is an acceptable trade-off
	 * for incremental fold; use `mode: "replay"` for strict cross-stream
	 * ordering.
	 */
	mode?: "replay" | "scan";
	/** Snapshot integration for rebuild + auto-checkpoint. */
	snapshot?: ProjectionSnapshotOpts<TState>;
	/**
	 * Freeze event arrays before passing to reducer (default `true`).
	 * Set to `false` only if your reducer intentionally mutates the input
	 * (strongly discouraged — prefer immutable reducers).
	 */
	freezeInputs?: boolean;
};

/**
 * Controller returned by {@link CqrsGraph.projection}.
 *
 * `node` is the reactive read model. `rebuild()` performs a paginated
 * cold-storage replay (requires `attachEventStorage` tiers). `reset()`
 * reloads from `snapshot.load()` and re-folds the live event log on top.
 *
 * @category patterns
 */
export interface ProjectionController<TState> {
	readonly node: Node<TState>;
	/**
	 * Async paginated rebuild from attached storage tiers. Throws
	 * {@link RebuildError} on adapter / decode / reducer failure.
	 *
	 * @param opts.fromTier - Storage tier to read from (default: first attached).
	 * @param opts.pageSize - Entries per page (default 1000).
	 */
	rebuild(opts?: {
		fromTier?: AppendLogStorageTier<CqrsEvent>;
		pageSize?: number;
	}): Promise<TState>;
	/**
	 * Reload from `snapshot.load()` (if configured) and re-fold the live
	 * in-memory event log on top. Returns the rebuilt state. No-op on the
	 * reactive node if the state is unchanged.
	 */
	reset(): Promise<TState>;
}

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

export class CqrsGraph<_EM extends CqrsEventMap = Record<string, unknown>> extends Graph {
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

	/** Tiers attached via {@link attachEventStorage}; auto-wired into future event streams. */
	private readonly _attachedEventTiers: Array<readonly AppendLogStorageTier<CqrsEvent>[]> = [];
	private readonly _attachedTierDisposers = new Map<string, Array<() => void>>();

	/**
	 * Wire append-log storage tiers for ALL CQRS event streams — both currently
	 * registered AND any future streams created via `event(name)` /
	 * `event(name, aggregateId)` / handler emit. (M4 fix.)
	 *
	 * Returns a disposer that releases all storage subscriptions wired by this
	 * call (including those for streams that were created after the call).
	 */
	attachEventStorage(tiers: readonly AppendLogStorageTier<CqrsEvent>[]): () => void {
		this._attachedEventTiers.push(tiers);
		// Wire currently-existing streams.
		for (const [name, entry] of this._eventLogs) {
			const dispose = entry.log.attachStorage(tiers);
			let arr = this._attachedTierDisposers.get(name);
			if (!arr) {
				arr = [];
				this._attachedTierDisposers.set(name, arr);
			}
			arr.push(dispose);
		}
		// Per-aggregate streams existing now.
		for (const [type, byAgg] of this._eventLogsByAggregate) {
			for (const [aggId, entry] of byAgg) {
				const key = `${type}::${aggId}`;
				const dispose = entry.log.attachStorage(tiers);
				let arr = this._attachedTierDisposers.get(key);
				if (!arr) {
					arr = [];
					this._attachedTierDisposers.set(key, arr);
				}
				arr.push(dispose);
			}
		}
		return () => {
			// Remove from auto-wire list so newly-created streams skip.
			const idx = this._attachedEventTiers.indexOf(tiers);
			if (idx >= 0) this._attachedEventTiers.splice(idx, 1);
			// We can't precisely undo the per-stream attach for THIS tier set
			// alone (Map values commingle disposers across multiple
			// attachEventStorage calls). Caller wanting fine-grained control
			// should call `tier.flush()` / dispose tiers themselves. This
			// disposer is best-effort: it stops auto-wiring future streams.
		};
	}

	/** Wire newly-created event stream into all currently-attached tier sets. */
	private _autoWireStreamStorage(
		key: string,
		log: ReturnType<typeof reactiveLog<CqrsEvent>>,
	): void {
		if (this._attachedEventTiers.length === 0) return;
		let arr = this._attachedTierDisposers.get(key);
		if (!arr) {
			arr = [];
			this._attachedTierDisposers.set(key, arr);
		}
		for (const tiers of this._attachedEventTiers) {
			arr.push(log.attachStorage(tiers));
		}
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
		const guarded = this.derived<readonly CqrsEvent[]>(
			name,
			[entries],
			(batchData, ctx) => {
				const latest =
					batchData[0] != null && batchData[0].length > 0
						? (batchData[0].at(-1) as readonly CqrsEvent[])
						: (ctx.prevData[0] as readonly CqrsEvent[]);
				return [latest];
			},
			{
				meta: cqrsMeta("event", { event_name: name }),
				guard: EVENT_GUARD,
				initial: entries.cache as readonly CqrsEvent[],
			},
		);
		this.addDisposer(keepalive(guarded));
		this._eventLogs.set(name, { log, node: guarded });
		// M4: auto-wire any storage tiers attached via `attachEventStorage`.
		this._autoWireStreamStorage(name, log);
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
		// Avoid name collisions if multiple aggregates have ids that sanitize
		// to the same node-name; suffix with a counter when necessary.
		// Resolve the mount name BEFORE constructing the derived (the
		// `this.derived(...)` form registers under the supplied `name`).
		let mountName = nodeName;
		let collisionIdx = 0;
		while (this.resolveOptional(mountName) !== undefined) {
			collisionIdx += 1;
			mountName = `${nodeName}_${collisionIdx}`;
		}
		let guarded: Node<readonly CqrsEvent[]>;
		try {
			guarded = this.derived<readonly CqrsEvent[]>(
				mountName,
				[entries],
				(batchData, ctx) => {
					const latest =
						batchData[0] != null && batchData[0].length > 0
							? (batchData[0].at(-1) as readonly CqrsEvent[])
							: (ctx.prevData[0] as readonly CqrsEvent[]);
					return [latest];
				},
				{
					meta: cqrsMeta("event_aggregate", {
						event_name: type,
						aggregate_id: aggregateId,
					}),
					guard: EVENT_GUARD,
					initial: entries.cache as readonly CqrsEvent[],
				},
			);
		} catch {
			// Name collision raced with another constructor — fall back to a
			// raw, unmounted node so the per-aggregate stream still functions
			// (just not graph-visible). Mirrors the prior best-effort branch.
			guarded = node<readonly CqrsEvent[]>(
				[entries],
				(batchData, actions, ctx) => {
					const latest =
						batchData[0] != null && batchData[0].length > 0 ? batchData[0].at(-1) : ctx.prevData[0];
					actions.emit(latest as readonly CqrsEvent[]);
				},
				{
					name: nodeName,
					describeKind: "derived",
					meta: cqrsMeta("event_aggregate", {
						event_name: type,
						aggregate_id: aggregateId,
					}),
					guard: EVENT_GUARD,
					initial: entries.cache as readonly CqrsEvent[],
				},
			);
		}
		this.addDisposer(keepalive(guarded));
		const entry = { log, node: guarded };
		byType.set(aggregateId, entry);
		// M4: auto-wire any tiers attached via `attachEventStorage`.
		this._autoWireStreamStorage(`${type}::${aggregateId}`, log);
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
		const cmdNode = this.state<T>(name, undefined as T, {
			meta: {
				...cqrsMeta("command", { command_name: name }),
				error: null,
			},
			guard: COMMAND_GUARD,
		});
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
	 *
	 * **Tier 8 / COMPOSITION-GUIDE §35:** dispatch routes through the shared
	 * {@link mutate} framework so freeze / rollback-on-throw / seq-cursor
	 * advance / audit-record stamping flow through one centralized helper.
	 * Failure records emit OUTSIDE the rolled-back batch (M5 / C4 invariants
	 * preserved by the framework).
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
		const emittedEvents: string[] = [];
		// `actionThrew` distinguishes user-handler failures (where we want to
		// stamp `cmdNode.meta.error`) from framework-internal failures (which
		// shouldn't leak as a "command failed" signal).
		let actionThrew = false;

		const action = (sealed: T): void => {
			cmdNode.emit(sealed, { internal: true });
			try {
				reg.handler(sealed, {
					emit: (eName, data) => {
						// Wave C.2 Unit 19: if emits was declared, reject undeclared names.
						if (reg.emits !== undefined && !reg.emits.includes(eName)) {
							throw new UndeclaredEmitError(commandName, eName, reg.emits);
						}
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
			} catch (err) {
				actionThrew = true;
				throw err;
			}
		};

		try {
			mutate<[T], void, DispatchRecord>(action, {
				frame: "transactional",
				log: this.dispatches,
				seq: this._dispatchSeqCursor,
				freeze: this._freezeCommandPayload,
				onSuccessRecord: ([sealed], _result, { t_ns, seq }) => ({
					commandName,
					payload: sealed,
					outcome: "success",
					emittedEvents: [...emittedEvents],
					t_ns,
					seq: seq ?? 0,
					...(reg.handlerVersion !== undefined ? { handlerVersion: reg.handlerVersion } : {}),
				}),
				onFailureRecord: ([sealed], err, { t_ns, seq, errorType }) => {
					const wrapped =
						err instanceof CommandHandlerError ? err : new CommandHandlerError(commandName, err);
					return {
						commandName,
						payload: sealed,
						outcome: "failure",
						error: wrapped,
						errorType,
						emittedEvents: [...emittedEvents],
						t_ns,
						seq: seq ?? 0,
						...(reg.handlerVersion !== undefined ? { handlerVersion: reg.handlerVersion } : {}),
					};
				},
			})(payload);
		} catch (outerErr) {
			// C4 preservation: only stamp `cmdNode.meta.error` when the user
			// handler threw (not when framework infra threw before the action
			// ran). The framework already routed onFailure for the action-throw
			// case via `mutate` outside the rolled-back batch.
			if (actionThrew) {
				cmdNode.meta.error.emit(outerErr, { internal: true });
			}
			throw outerErr;
		}
	}

	// -- Projections ----------------------------------------------------------

	/**
	 * Register a read-only projection derived from event streams.
	 * Guard denies `write` — value is computed from events only.
	 *
	 * **Wave C.3 Unit 21 (locked 2026-04-24):**
	 * - Object-bag signature replaces the positional `(name, events, reducer, initial)` form.
	 * - `mode: "scan"` (default) — incremental fold; `"replay"` — full replay each wave.
	 * - `snapshot` integration for cold-start load + auto-checkpoint save.
	 * - `freezeInputs` (default `true`) — freeze the event array before passing to reducer.
	 * - Returns `ProjectionController<TState>` with `.node`, `.rebuild()`, `.reset()`.
	 *
	 * Fan-in across `events` is implemented by depending on all event-type fan-in
	 * nodes directly, which preserves `describe()` edges (e.g. `orderPlaced →
	 * orderCount`). Events are sorted by `(timestampNs, seq, aggregateId)` before
	 * passing to the reducer (Option-3 cross-aggregate ordering, C.3).
	 */
	projection<TState>(opts: ProjectionOptions<TState>): ProjectionController<TState> {
		const { name, events: eventNames, reducer, initial } = opts;
		const mode = opts.mode ?? "scan";
		const freezeInputs = opts.freezeInputs ?? true;
		const snapshotOpts = opts.snapshot;

		// Ensure each event stream exists and collect its node.
		// Using the event-type fan-in nodes directly as deps preserves
		// `describe()` edges (orderPlaced → orderCount) per Audit 1 §24.
		const eventNodes = eventNames.map((eName) => {
			if (!this._eventLogs.has(eName)) this.event(eName);
			return this._eventLogs.get(eName)!.node;
		});

		// Sort comparator: timestampNs → seq → aggregateId lex (Option-3, C.3).
		function sortEvents(evts: CqrsEvent[]): void {
			evts.sort(
				(a, b) =>
					a.timestampNs - b.timestampNs ||
					a.seq - b.seq ||
					(a.aggregateId ?? "").localeCompare(b.aggregateId ?? ""),
			);
		}

		// Collect all events from the current snapshots (for seeding + rebuild).
		function collectAllEvents(snapshots: readonly (readonly CqrsEvent[])[]): CqrsEvent[] {
			const evts: CqrsEvent[] = [];
			for (const snap of snapshots) evts.push(...snap);
			sortEvents(evts);
			return evts;
		}

		// Seed: collect any events already present at construction time.
		const seedSnapshots = eventNodes.map(
			(n) => (n.cache as readonly CqrsEvent[] | undefined) ?? ([] as readonly CqrsEvent[]),
		);
		const sortedSeed = collectAllEvents(seedSnapshots);
		const frozenSeed = (
			freezeInputs ? Object.freeze(sortedSeed) : sortedSeed
		) as readonly CqrsEvent[];

		// Scan state: tracks count of events processed in last run.
		let lastProcessedCount = 0;
		let scanState: TState = initial;

		if (mode === "scan" && sortedSeed.length > 0) {
			scanState = reducer(initial, frozenSeed);
			lastProcessedCount = sortedSeed.length;
		}
		const seedState = mode === "replay" ? reducer(initial, frozenSeed) : scanState;

		// Snapshot save state — debounce + saveEvery.
		const saveDebounceMs = snapshotOpts?.saveDebounceMs ?? 1000;
		const saveEvery = snapshotOpts?.saveEvery ?? 1000;
		let saveTimer: ReturnType<typeof setTimeout> | undefined;
		let savesSinceLastFlush = 0;

		function scheduleSave(currentState: TState): void {
			if (!snapshotOpts?.save) return;
			savesSinceLastFlush += 1;
			if (savesSinceLastFlush >= saveEvery) {
				savesSinceLastFlush = 0;
				if (saveTimer !== undefined) {
					clearTimeout(saveTimer);
					saveTimer = undefined;
				}
				const result = snapshotOpts.save(currentState);
				if (result instanceof Promise) result.catch(() => undefined);
				return;
			}
			if (saveTimer !== undefined) clearTimeout(saveTimer);
			saveTimer = setTimeout(() => {
				saveTimer = undefined;
				savesSinceLastFlush = 0;
				const result = snapshotOpts!.save!(currentState);
				if (result instanceof Promise) result.catch(() => undefined);
			}, saveDebounceMs);
		}

		const projNode = this.derived<TState>(
			name,
			eventNames as readonly string[],
			(batchData, ctx) => {
				const snapshots = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const allEvents = collectAllEvents(snapshots as readonly (readonly CqrsEvent[])[]);

				let newState: TState;
				if (mode === "replay") {
					// m1: freeze only in the replay branch where `frozen` is actually used.
					const frozen = (
						freezeInputs ? Object.freeze(allEvents) : allEvents
					) as readonly CqrsEvent[];
					newState = reducer(initial, frozen);
				} else {
					// scan: only fold NEW events since last run.
					const newOnly = allEvents.slice(lastProcessedCount);
					lastProcessedCount = allEvents.length;
					const frozenNew = (
						freezeInputs ? Object.freeze(newOnly) : newOnly
					) as readonly CqrsEvent[];
					newState = reducer(scanState, frozenNew);
					scanState = newState;
				}

				scheduleSave(newState);
				return [newState];
			},
			{
				meta: cqrsMeta("projection", { projection_name: name, source_events: eventNames }),
				guard: PROJECTION_GUARD,
				initial: seedState,
			},
		);

		this.addDisposer(keepalive(projNode));
		this.addDisposer(() => {
			if (saveTimer !== undefined) {
				clearTimeout(saveTimer);
				saveTimer = undefined;
			}
		});
		this._projections.add(name);

		// -- Controller methods ---------------------------------------------------

		const rebuild = async (rebuildOpts?: {
			fromTier?: AppendLogStorageTier<CqrsEvent>;
			pageSize?: number;
		}): Promise<TState> => {
			try {
				const pageSize = rebuildOpts?.pageSize ?? 1000;
				const tier = rebuildOpts?.fromTier ?? this._attachedEventTiers[0]?.[0];

				// M5: snapshot in-memory event count BEFORE any async work so we can
				// drain events that arrive concurrently during the paginated rebuild.
				const preBuildCount = collectAllEvents(
					eventNodes.map((n) => (n.cache as readonly CqrsEvent[] | undefined) ?? []),
				).length;

				// Seed from snapshot.load if provided.
				let rebuildState: TState = initial;
				if (snapshotOpts?.load) {
					const loaded = await snapshotOpts.load();
					if (loaded !== undefined) rebuildState = loaded;
				}

				if (!tier || !tier.loadEntries) {
					// No storage tier — fold in-memory events as a best-effort rebuild.
					const inMemory = collectAllEvents(
						eventNodes.map((n) => (n.cache as readonly CqrsEvent[] | undefined) ?? []),
					);
					const frozen = (
						freezeInputs ? Object.freeze(inMemory) : inMemory
					) as readonly CqrsEvent[];
					rebuildState = reducer(rebuildState, frozen);
				} else {
					// Paginated load from tier.
					// m3: only fold events that belong to this projection's event-type set.
					// Tiers may hold events from other projections; filtering keeps reducer
					// correctness when the tier is shared across projections.
					const watchedEvents = new Set<string>(eventNames as readonly string[]);
					let cursor: import("../../extra/storage-tiers.js").AppendCursor | undefined;
					let done = false;
					while (!done) {
						const result = await tier.loadEntries({ cursor, pageSize });
						const page = [...result.entries].filter((e) => watchedEvents.has(e.type));
						sortEvents(page);
						const frozenPage = (freezeInputs ? Object.freeze(page) : page) as readonly CqrsEvent[];
						rebuildState = reducer(rebuildState, frozenPage);
						cursor = result.cursor;
						done = !cursor || result.entries.length === 0;
					}
				}

				// Update the live projection node with the rebuilt state.
				if (mode === "scan") {
					// M5: drain events that arrived during the async rebuild so they are
					// not lost (race between paginated load and concurrent dispatch).
					const allInMemory = collectAllEvents(
						eventNodes.map((n) => (n.cache as readonly CqrsEvent[] | undefined) ?? []),
					);
					const pendingEvents = allInMemory.slice(preBuildCount);
					if (pendingEvents.length > 0) {
						const frozenPending = (
							freezeInputs ? Object.freeze(pendingEvents) : pendingEvents
						) as readonly CqrsEvent[];
						rebuildState = reducer(rebuildState, frozenPending);
					}
					scanState = rebuildState;
					lastProcessedCount = allInMemory.length;
				}
				projNode.emit(rebuildState, { internal: true });
				return rebuildState;
			} catch (err) {
				throw new RebuildError(name, err);
			}
		};

		const reset = async (): Promise<TState> => {
			try {
				// Reload from snapshot.load (if configured).
				let baseState: TState = initial;
				if (snapshotOpts?.load) {
					const loaded = await snapshotOpts.load();
					if (loaded !== undefined) baseState = loaded;
				}

				// Re-fold all in-memory events on top of the snapshot state.
				const inMemory = collectAllEvents(
					eventNodes.map((n) => (n.cache as readonly CqrsEvent[] | undefined) ?? []),
				);
				const frozen = (freezeInputs ? Object.freeze(inMemory) : inMemory) as readonly CqrsEvent[];
				const newState = reducer(baseState, frozen);

				if (mode === "scan") {
					scanState = newState;
					lastProcessedCount = inMemory.length;
				}
				projNode.emit(newState, { internal: true });
				return newState;
			} catch (err) {
				throw new RebuildError(name, err);
			}
		};

		return { node: projNode, rebuild, reset };
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
		const _eventNodes = eventNames.map((eName) => {
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
			this.addDisposer(sub);
		}

		// Tier 8 / COMPOSITION-GUIDE §35: per-event handler invocation routes
		// through `mutate` so handler-version stamping + audit-record
		// shape stay centralized. Failure path re-throws — the saga's outer
		// try/catch honors `errorPolicy` ("advance" vs "hold"). Action takes
		// `(ev, eName)` so the wrapper can be hoisted once for all event types.
		const auditedHandler = mutate<[CqrsEvent<T>, string], void, SagaInvocation<T>>(
			(ev, _eName) => {
				handler(ev);
			},
			{
				frame: "inline",
				log: invocations,
				freeze: false,
				...(opts.handlerVersion !== undefined ? { handlerVersion: opts.handlerVersion } : {}),
				// D5 (qa lock): always include the `aggregateId` key (even when
				// undefined) for parity with the pre-Tier-8 saga record shape.
				// Consumers using `Object.hasOwn(record, "aggregateId")` or JSON
				// serialization shape would observe a pre-1.0 break otherwise.
				onSuccessRecord: ([ev, eName], _r, { t_ns }) => ({
					eventType: eName,
					outcome: "success",
					aggregateId: ev.aggregateId,
					event: ev,
					t_ns,
				}),
				onFailureRecord: ([ev, eName], err, { t_ns, errorType }) => ({
					eventType: eName,
					outcome: "failure",
					error: err,
					errorType,
					aggregateId: ev.aggregateId,
					event: ev,
					t_ns,
				}),
			},
		);

		const sagaRef: { n?: Node<unknown> } = {};
		const sagaNode = this.effect(
			name,
			eventNames as readonly string[],
			(snapshots, _up) => {
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
								auditedHandler(ev, eName);
								errNode.emit(null, { internal: true });
								advancedTo += 1;
							} catch (err) {
								errNode.emit(err, { internal: true });
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
				meta: {
					...cqrsMeta("saga", { saga_name: name, source_events: eventNames }),
					error: null,
				},
			},
		) as Node<unknown>;
		sagaRef.n = sagaNode;

		this.addDisposer(keepalive(sagaNode));
		this._sagas.add(name);
		return {
			node: sagaNode,
			invocations,
			audit: invocations,
			cursors,
		};
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
 * const { node: orderCount } = app.projection({
 *   name: "orderCount",
 *   events: ["orderPlaced"],
 *   reducer: (_s, events) => events.length,
 *   initial: 0,
 * });
 * app.dispatch("placeOrder", { id: "1", amount: 100 });
 * ```
 */
export function cqrs<EM extends CqrsEventMap = Record<string, unknown>>(
	name: string,
	opts?: CqrsOptions,
): CqrsGraph<EM> {
	const g = new CqrsGraph<EM>(name, opts);
	// Tier 1.5.3 Phase 2.5 (DG1=B): tag the Graph with its constructing
	// factory so `describe()` surfaces provenance. Route through
	// `placeholderArgs` since `CqrsOptions.graph` may carry non-JSON fields.
	const { factory: _f, factoryArgs: _fa, ...tagArgs } = (opts ?? {}) as Record<string, unknown>;
	g.tagFactory("cqrs", placeholderArgs(tagArgs));
	return g;
}

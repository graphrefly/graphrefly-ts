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

import { batch } from "../core/batch.js";
import { wallClockNs } from "../core/clock.js";
import { policy } from "../core/guard.js";
import { derived, type Node, node, state } from "../core/index.js";
import { reactiveLog } from "../extra/reactive-log.js";
import { Graph, type GraphOptions } from "../graph/index.js";

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

import { domainMeta, keepalive } from "./_internal.js";

function cqrsMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("cqrs", kind, extra);
}

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

/**
 * Immutable envelope for events emitted by command handlers.
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
	/** V0 identity of the event log node at append time (§6.0b). */
	v0?: { id: string; version: number };
};

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
};

// ---------------------------------------------------------------------------
// CqrsGraph
// ---------------------------------------------------------------------------

type EventEntry = {
	log: ReturnType<typeof reactiveLog<CqrsEvent>>;
	node: Node<readonly CqrsEvent[]>;
};

export class CqrsGraph extends Graph {
	private readonly _eventLogs = new Map<string, EventEntry>();
	private readonly _commandHandlers = new Map<string, CommandHandler<any>>();
	private readonly _projections = new Set<string>();
	private readonly _sagas = new Set<string>();
	private readonly _keepaliveDisposers: Array<() => void> = [];
	private _eventStore: EventStoreAdapter | undefined;
	private _seq = 0;

	constructor(name: string, opts: CqrsOptions = {}) {
		super(name, opts.graph);
	}

	override destroy(): void {
		for (const dispose of this._keepaliveDisposers) dispose();
		this._keepaliveDisposers.length = 0;
		super.destroy();
	}

	// -- Events ---------------------------------------------------------------

	/**
	 * Register a named event stream backed by `reactiveLog`.
	 * Guard denies external `write` — only commands append internally.
	 */
	event(name: string): Node<readonly CqrsEvent[]> {
		const existing = this._eventLogs.get(name);
		if (existing) return existing.node;

		// V0 versioning is attached at construction — post-hoc
		// `_applyVersioning` was deleted because it opened a re-entrance
		// window where a wave could observe `_versioning` transitioning from
		// `undefined` to a fresh state. Construction-time-only means the
		// flag is frozen at birth.
		const log = reactiveLog<CqrsEvent>([], { name, versioning: 0 });
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

	/** Internal: append to an event log, auto-registering if needed. */
	private _appendEvent(eventName: string, payload: unknown): void {
		let entry = this._eventLogs.get(eventName);
		if (!entry) {
			this.event(eventName);
			entry = this._eventLogs.get(eventName)!;
		}
		// Guard: reject dispatch to terminated event streams
		if (entry.node.status === "completed" || entry.node.status === "errored") {
			throw new Error(
				`Cannot dispatch to terminated event stream "${eventName}" (status: ${entry.node.status}).`,
			);
		}
		const nv = entry.log.entries.v;
		const evt: CqrsEvent = {
			type: eventName,
			payload,
			timestampNs: wallClockNs(),
			seq: ++this._seq,
			...(nv != null ? { v0: { id: nv.id, version: nv.version } } : {}),
		};
		entry.log.append(evt);
		if (this._eventStore) {
			this._eventStore.persist(evt);
		}
	}

	// -- Commands -------------------------------------------------------------

	/**
	 * Register a command with its handler. Guard denies `observe` (write-only).
	 * Use `dispatch(name, payload)` to execute.
	 *
	 * The command node carries dynamic `meta.error` — a reactive companion
	 * that holds the last handler error (or `null` on success).
	 */
	command<T = unknown>(name: string, handler: CommandHandler<T>): Node<T> {
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
		this._commandHandlers.set(name, handler as CommandHandler<any>);
		return cmdNode;
	}

	/**
	 * Execute a registered command. Wraps the entire dispatch in `batch()` so
	 * the command node DATA and all emitted events settle atomically.
	 *
	 * If the handler throws, `meta.error` on the command node is set to the
	 * error and the exception is re-thrown.
	 */
	dispatch<T = unknown>(commandName: string, payload: T): void {
		const handler = this._commandHandlers.get(commandName);
		if (!handler) {
			throw new Error(`Unknown command: "${commandName}". Register with .command() first.`);
		}
		const cmdNode = this.resolve(commandName);
		batch(() => {
			cmdNode.emit(payload, { internal: true });
			try {
				handler(payload, { emit: (eName, data) => this._appendEvent(eName, data) });
				cmdNode.meta.error.emit(null, { internal: true });
			} catch (err) {
				cmdNode.meta.error.emit(err, { internal: true });
				throw err;
			}
		});
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
	): Node<unknown> {
		const eventNodes = eventNames.map((eName) => {
			if (!this._eventLogs.has(eName)) this.event(eName);
			return this._eventLogs.get(eName)!.node;
		});

		// Track last-processed entry count per event to only process new entries
		const lastCounts = new Map<string, number>();

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
					const eName = eventNames[i];
					const lastCount = lastCounts.get(eName) ?? 0;
					if (entries.length > lastCount) {
						const newEntries = entries.slice(lastCount);
						for (const entry of newEntries) {
							try {
								handler(entry as CqrsEvent<T>);
								errNode.emit(null, { internal: true });
							} catch (err) {
								errNode.emit(err, { internal: true });
							}
						}
						lastCounts.set(eName, entries.length);
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
		return sagaNode;
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
export function cqrs(name: string, opts?: CqrsOptions): CqrsGraph {
	return new CqrsGraph(name, opts);
}

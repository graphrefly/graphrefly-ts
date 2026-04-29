/**
 * Process Manager pattern (Phase 7 — roadmap §4.6, Audit 3 — locked 2026-04-24).
 *
 * Reactive long-running workflow primitive over CQRS event nodes.
 * Correlates events across aggregates, tracks per-instance state, supports
 * retries with backoff, and runs compensation on failure or explicit cancel.
 *
 * ## Architecture
 *
 * - Per-instance state lives in a `Map<correlationId, TState>` closure (in-memory).
 *   The `_process_<name>_started` synthetic event is dispatched per `start()`
 *   for an event-sourced audit trail using `correlationId` as `aggregateId`.
 *   Cross-restart state recovery is opt-in via
 *   `opts.persistence.stateStorage` (kv-tier per-correlationId snapshot,
 *   Tier 6.5 3.5) plus an explicit `restore()` call after construction.
 * - Watched-event subscriptions are imperative (coordinator role) — each
 *   watched CQRS event type is subscribed to via `entries.subscribe(...)`.
 *   These are NOT reactive node edges; the process manager is intentionally
 *   a coordinator that bridges reactive CQRS events into imperative instance logic.
 * - Step execution uses `fromAny` to uniformly handle sync and async handlers.
 * - Retry delays use `setTimeout` (same sanctioned pattern as `extra/resilience.ts`
 *   retry helper — this primitive is a coordinator, not a reactive pipeline stage).
 * - Timer scheduling uses `fromTimer` from `extra/sources.ts` per spec §5.8.
 * - Audit log uses `createAuditLog` per Audit 2.
 *
 * @module
 */

import { wallClockNs } from "../../core/clock.js";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import {
	type BaseAuditRecord,
	createAuditLog,
	registerCursor,
	wrapMutation,
} from "../../extra/mutation/index.js";
import type { ReactiveLogBundle } from "../../extra/reactive-log.js";
import { fromAny, fromTimer, type NodeInput } from "../../extra/sources.js";
import type { AppendLogStorageTier, KvStorageTier } from "../../extra/storage-tiers.js";
import { Graph } from "../../graph/index.js";
import type { CqrsEvent, CqrsEventMap, CqrsGraph } from "../cqrs/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminated union returned by each step handler.
 *
 * - `"success"` — step ran cleanly; update state, optionally emit
 *   side-effect events and schedule a future synthetic event. The process
 *   instance stays `"running"`.
 * - `"terminate"` — workflow complete; instance moves to `"terminated"`.
 *   Process-specific extension to the canonical outcome enum.
 * - `"failure"` — triggers compensation; instance moves to `"compensated"` /
 *   `"errored"`.
 *
 * Field name is `outcome` (matching `cqrs.DispatchRecord.outcome` and the
 * canonical Tier 1.6.2 / 2.3 enum). `"success"` and `"failure"` are the
 * canonical values; `"terminate"` is the process-specific extension for
 * "early-return success".
 */
export type ProcessStepResult<TState> =
	| {
			outcome: "success";
			state: TState;
			emit?: readonly { type: string; payload: unknown }[];
			schedule?: ProcessSchedule;
	  }
	| {
			outcome: "terminate";
			state: TState;
			emit?: readonly { type: string; payload: unknown }[];
			reason?: string;
	  }
	| { outcome: "failure"; error: unknown };

/**
 * Schedule a synthetic timer event after `afterMs` milliseconds.
 * When the timer fires, the synthetic event of `eventType` is routed to the
 * matching step (if one is registered) for this correlationId.
 */
export type ProcessSchedule = { afterMs: number; eventType: string };

/**
 * Step handler signature.
 *
 * Receives the current instance state and the triggering CQRS event.
 * Returns a {@link ProcessStepResult} — sync value, Promise, or any
 * {@link NodeInput} consumed via `fromAny`.
 */
export type ProcessStep<TState, EM extends CqrsEventMap, K extends keyof EM & string> = (
	state: TState,
	event: CqrsEvent<EM[K]>,
) => NodeInput<ProcessStepResult<TState>>;

/**
 * Compensation handler. Runs when a step returns `outcome: "failure"`, throws, or
 * when `cancel(correlationId)` is called on a running instance.
 *
 * Should undo any side effects performed by prior steps (refund, cancel
 * reservation, etc.). Errors thrown inside compensate are swallowed and
 * recorded in the audit log with `status: "errored"` to prevent cascading
 * failure loops.
 */
export type ProcessCompensate<TState> = (state: TState, error: unknown) => NodeInput<void>;

/**
 * Audit record for a single process instance state transition.
 *
 * Every status change (start → running → terminated / errored / compensated)
 * appends one record. `correlationId` is the stable process key.
 *
 * Extends {@link BaseAuditRecord} so records carry `t_ns` / `seq` /
 * `handlerVersion` from the cross-cutting Audit 2 schema.
 */
export interface ProcessInstance<TState> extends BaseAuditRecord {
	/** Stable correlation key that identifies this process instance. */
	readonly correlationId: string;
	/** Most-recent instance state at this transition. */
	readonly state: TState;
	/** Current lifecycle status after this transition. */
	readonly status: "running" | "terminated" | "errored" | "compensated";
	/** Wall-clock nanoseconds when `start()` was called. */
	readonly startedAt: number;
	/** Wall-clock nanoseconds of this transition. */
	readonly updatedAt: number;
	/** Handler version stamped at transition time (Audit 5). */
	readonly handlerVersion?: { id: string; version: string | number };
	/** Optional human-readable reason for cancellation. Present only on `"compensated"` records produced by `cancel()`. */
	readonly reason?: string;
}

/**
 * Recommended `keyOf` for storage tiers keyed by correlationId (Audit 2).
 */
export const processInstanceKeyOf = <TState>(i: ProcessInstance<TState>): string => i.correlationId;

/**
 * Per-correlationId state snapshot persisted via
 * {@link ProcessManagerOpts.persistence.stateStorage} (Tier 6.5 3.5,
 * 2026-04-29). Captures the running instance's current state plus
 * lifecycle metadata so a fresh `processManager` can resume in-flight
 * workflows after restart via {@link ProcessManagerResult.restore}.
 *
 * Terminal records (`status` ∈ `"terminated" | "errored" | "compensated"`)
 * are deleted from the kv tier on transition — only running instances
 * persist between restarts.
 */
export interface ProcessStateSnapshot<TState> {
	readonly correlationId: string;
	readonly state: TState;
	readonly status: "running" | "terminated" | "errored" | "compensated";
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly handlerVersion?: { id: string; version: string | number };
}

/** Recommended `keyOf` for `KvStorageTier<ProcessStateSnapshot<...>>`. */
export const processStateKeyOf = <TState>(s: ProcessStateSnapshot<TState>): string =>
	s.correlationId;

/**
 * Options for {@link processManager}.
 */
export interface ProcessManagerOpts<TState, EM extends CqrsEventMap> {
	/** Initial state value for every new process instance. */
	readonly initial: TState;
	/** CQRS event types to watch for correlation routing. */
	readonly watching: readonly (keyof EM & string)[];
	/**
	 * Per-event-type step handlers. A step is invoked when a watched event's
	 * `correlationId` matches a running instance and the event type is in
	 * `steps`. Events with no matching step are silently ignored.
	 */
	readonly steps: { [K in keyof EM & string]?: ProcessStep<TState, EM, K> };
	/**
	 * Optional compensation handler. Runs on step `outcome: "failure"` / step throw
	 * and on explicit `cancel()`. If omitted, instances fail silently with
	 * status `"errored"` instead of `"compensated"`.
	 */
	readonly compensate?: ProcessCompensate<TState>;
	/**
	 * Optional predicate called after each `"success"` step. When it returns
	 * `true`, the instance is moved to `"terminated"` immediately without
	 * waiting for a `"terminate"` step result.
	 */
	readonly isTerminal?: (state: TState) => boolean;
	/**
	 * Maximum number of retry attempts after a step throws (not counting the
	 * first attempt). Default: `0` (no retry — fail immediately on throw).
	 */
	readonly retryMax?: number;
	/**
	 * Per-retry backoff delays in milliseconds. `backoffMs[i]` is the delay
	 * before attempt `i + 1`. If fewer entries than `retryMax`, the last entry
	 * is repeated. Default: `[0]` (no delay).
	 *
	 * **Implementation note:** retry delays are implemented with `setTimeout`
	 * (same sanctioned exception as `extra/resilience.ts`). This is a
	 * coordinator-layer primitive — `fromTimer` would require subscribing to
	 * an additional node per attempt, which would leak timer nodes without a
	 * clear disposal scope.
	 */
	readonly backoffMs?: readonly number[];
	/** Handler version tag stamped onto audit records (Audit 5). */
	readonly handlerVersion?: { id: string; version: string | number };
	/** Optional persistence wiring (Audit 4). */
	readonly persistence?: {
		/**
		 * Wire the per-process synthetic state event stream to append-log tiers.
		 * Reuses `CqrsGraph.attachEventStorage` so events persist across restarts.
		 */
		eventStorage?: readonly AppendLogStorageTier<CqrsEvent>[];
		/**
		 * Wire per-correlationId state snapshots to kv tiers (Tier 6.5 3.5,
		 * 2026-04-29). Each `start()` and step transition writes the running
		 * instance's state under its `correlationId`; terminal transitions
		 * (`terminated` / `errored` / `compensated`) `delete` the key. After
		 * restart, callers invoke {@link ProcessManagerResult.restore} to
		 * reload running instances from the first tier.
		 *
		 * Uses {@link KvStorageTier} (not snapshot tier) because per-instance
		 * state is N records keyed by correlationId, not a single global
		 * snapshot. {@link processStateKeyOf} is the recommended `keyOf`
		 * (already aligned with the kv tier's `save(key, value)` shape).
		 *
		 * Terminal records are NOT preserved — historical lifecycle is the
		 * audit log's job. State persistence covers crash-recovery only.
		 */
		stateStorage?: readonly KvStorageTier<ProcessStateSnapshot<TState>>[];
	};
}

/**
 * Result handle returned by {@link processManager}.
 */
export interface ProcessManagerResult<TState> {
	/**
	 * Reactive audit log of every process instance state transition.
	 * Every `start()`, step result, retry, cancellation, and compensation
	 * appends a {@link ProcessInstance} record.
	 */
	readonly instances: ReactiveLogBundle<ProcessInstance<TState>>;
	/**
	 * Alias for {@link instances} (Audit 2 `.audit` duplication convention).
	 */
	readonly audit: ReactiveLogBundle<ProcessInstance<TState>>;
	/**
	 * Start a new process instance identified by `correlationId`.
	 *
	 * Emits a synthetic `_process_<name>_started` event into the CQRS graph
	 * with `correlationId` as `aggregateId` so per-aggregate streams record
	 * the process lifecycle. If the correlationId already has an active
	 * (running) instance, this call is a no-op (idempotent).
	 *
	 * @param correlationId - Stable key for this workflow instance.
	 * @param initialPayload - Optional payload carried on the start event.
	 */
	start(correlationId: string, initialPayload?: unknown): void;
	/**
	 * Cancel a running instance by correlationId.
	 *
	 * Triggers the `compensate` handler (if configured), then marks the
	 * instance as `"compensated"`. If the instance is not running, this is
	 * a no-op.
	 *
	 * @param correlationId - Instance to cancel.
	 * @param reason - Optional human-readable reason recorded in the audit log.
	 */
	cancel(correlationId: string, reason?: string): void;
	/**
	 * Synchronous read of the current in-memory state for a correlationId.
	 * Returns `undefined` if the instance does not exist or has terminated.
	 */
	getState(correlationId: string): TState | undefined;
	/**
	 * Restore running instances from the first {@link
	 * ProcessManagerOpts.persistence.stateStorage} tier (Tier 6.5 3.5,
	 * 2026-04-29). Loads every record in the tier and re-hydrates
	 * `instanceStates` / `activeInstances` / `startedAt` for any record
	 * whose `status === "running"`. Terminal records, if any persisted
	 * before delete fired, are silently skipped.
	 *
	 * Idempotent — calling twice doesn't double-restore (existing entries
	 * are overwritten). Returns the count of running instances rehydrated.
	 *
	 * No-op when no `stateStorage` tier is configured OR the first tier
	 * lacks a `list?` method (returns 0). Async because kv tier `load` /
	 * `list` may be async.
	 */
	restore(): Promise<number>;
	/**
	 * Release all watched-event subscriptions and stop processing new events.
	 *
	 * After `dispose()`, subsequent `start()` and `cancel()` calls are no-ops.
	 * In-flight async steps complete naturally; no new steps are dispatched.
	 */
	dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Materialise a `NodeInput<T>` into a Promise.
 * Uses `fromAny` to normalise Node / Promise / iterable / scalar, then
 * collects the first DATA message.
 *
 * - If `input` is `null` or `undefined`, resolves immediately with `undefined`
 *   (skips constructing a `fromAny` source).
 * - On COMPLETE without prior DATA, resolves with `undefined` (supports `void`
 *   compensate handlers whose `NodeInput<void>` delivers COMPLETE only).
 *
 * Implementation note: `fromAny` over a scalar (e.g. `void` / `undefined`) or
 * sync iterable delivers DATA synchronously inside `n.subscribe()`, BEFORE the
 * `subscribe()` call returns. We therefore use `let unsub` (not `const`) and
 * avoid calling `unsub()` until after `subscribe()` has returned — deferring
 * the cleanup to a microtask via `Promise.resolve().then(unsub)` to sidestep
 * the Temporal Dead Zone.
 */
function toPromise<T>(input: NodeInput<T>): Promise<T> {
	// Short-circuit: null/undefined input resolves immediately.
	if (input == null) return Promise.resolve(undefined as T);

	const n = fromAny<T>(input);
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		// `let` instead of `const` so that synchronous DATA delivery during
		// n.subscribe() (before the assignment completes) doesn't hit TDZ.
		let unsub: (() => void) | undefined;
		const cleanup = () => {
			if (unsub) {
				unsub();
			}
		};
		unsub = n.subscribe((msgs) => {
			if (settled) return;
			for (const m of msgs) {
				if (m[0] === DATA) {
					settled = true;
					// Defer cleanup to after the subscribe() call returns (TDZ-safe).
					Promise.resolve().then(cleanup);
					resolve(m[1] as T);
					return;
				}
				if (m[0] === ERROR) {
					settled = true;
					Promise.resolve().then(cleanup);
					reject(m[1] as unknown);
					return;
				}
				if (m[0] === COMPLETE) {
					// COMPLETE without prior DATA — resolve with undefined.
					// Supports void compensate handlers that return without emitting DATA.
					settled = true;
					Promise.resolve().then(cleanup);
					resolve(undefined as T);
					return;
				}
			}
		});
	});
}

/** Run `step(state, event)` with retry logic. Returns the step result. */
async function runWithRetry<TState>(
	step: (state: TState, event: CqrsEvent) => NodeInput<ProcessStepResult<TState>>,
	state: TState,
	event: CqrsEvent,
	retryMax: number,
	backoffMs: readonly number[],
): Promise<ProcessStepResult<TState>> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retryMax; attempt++) {
		if (attempt > 0) {
			// Sanctioned setTimeout for retry backoff in coordinator primitives.
			// Same pattern as extra/resilience.ts retry implementation.
			const delayMs = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
			if (delayMs > 0) {
				await new Promise<void>((r) => setTimeout(r, delayMs));
			}
		}
		try {
			const result = await toPromise(step(state, event));
			return result;
		} catch (err) {
			lastError = err;
			// If we've exhausted retries, fall through to return a fail result.
		}
	}
	return { outcome: "failure", error: lastError };
}

// ---------------------------------------------------------------------------
// processManager factory
// ---------------------------------------------------------------------------

/**
 * Create a process manager that coordinates long-running reactive workflows
 * over a {@link CqrsGraph}.
 *
 * Process instances are identified by `correlationId`. Events from the watched
 * event types are routed to per-instance step handlers when the event's
 * `correlationId` matches a running instance.
 *
 * ```ts
 * const app = cqrs<{ orderPlaced: { orderId: string }; paymentReceived: { amount: number } }>("orders");
 *
 * const pm = processManager(app, "fulfillment", {
 *   initial: { step: "awaiting-payment", total: 0 },
 *   watching: ["orderPlaced", "paymentReceived"],
 *   steps: {
 *     orderPlaced(state, event) {
 *       return { outcome: "success", state: { ...state, orderId: event.payload.orderId } };
 *     },
 *     paymentReceived(state, event) {
 *       return { outcome: "terminate", state: { ...state, total: event.payload.amount } };
 *     },
 *   },
 *   compensate(state, _error) {
 *     // undo reservation, issue refund, etc.
 *   },
 *   retryMax: 2,
 *   backoffMs: [100, 500],
 * });
 *
 * pm.start("order-123");
 * app.dispatch("orderPlaced", { orderId: "order-123" }, { correlationId: "order-123" });
 * ```
 *
 * @param cqrsGraph - The CQRS graph whose event streams the manager watches.
 * @param name - Stable identifier for this process type; used for the
 *   synthetic event-type prefix `_process_<name>_*`. Currently emits
 *   `_process_<name>_started` per `start()`; the prefix is reserved for
 *   future `_state` / `_timer` channels.
 * @param opts - Configuration: initial state, watched events, steps, retry,
 *   compensation, and optional persistence.
 * @returns {@link ProcessManagerResult} with `instances` audit log and
 *   `start`, `cancel`, `getState` imperative controls.
 *
 * @category patterns
 */
export function processManager<TState, EM extends CqrsEventMap = Record<string, unknown>>(
	cqrsGraph: CqrsGraph<EM>,
	name: string,
	opts: ProcessManagerOpts<TState, EM>,
): ProcessManagerResult<TState> {
	const retryMax = opts.retryMax ?? 0;
	const backoffMs: readonly number[] = opts.backoffMs ?? [0];
	const retainedLimit = 1024;

	// ── Per-instance in-memory state ──────────────────────────────────────
	// Map from correlationId → current TState for running instances.
	// Imperative coordinator state — documented pattern for this primitive.
	const instanceStates = new Map<string, TState>();
	// Track which instances are "active" (running) to prevent double-start
	// and to gate step delivery.
	const activeInstances = new Set<string>();
	// Track startedAt per instance.
	const startedAt = new Map<string, number>();

	// ── Audit log + seq cursor ────────────────────────────────────────────
	// EH-16 (Tier 6.5 3.3, 2026-04-29): the audit log + seq cursor are
	// mounted under a per-instance child Graph (`__processManagers__/<name>`)
	// rather than directly under `cqrsGraph._nodes`. `dispose()` then calls
	// `cqrsGraph.remove(...)` to unmount the subgraph cleanly via the
	// existing mount/removeMount lifecycle — no leaked nodes after repeated
	// create/dispose cycles. Pre-1.0 path-schema change: paths shift from
	// `${name}_process_instances` / `${name}_process_seq` (top-level) to
	// `__processManagers__/${name}::instances` / `::seq` (mounted).
	const mountName = `__processManagers__/${name}`;
	const subgraph = new Graph(name);
	try {
		cqrsGraph.mount(mountName, subgraph);
	} catch (err) {
		// `Graph.mount` throws if the mount name is in use; surface a
		// processManager-specific message so callers see actionable context.
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(
			`processManager: name "${name}" is already in use on this CQRS graph ` +
				`(mount path "${mountName}" collides). Call .dispose() on the prior ` +
				`manager OR pick a different name before re-creating. (${detail})`,
		);
	}

	const instances = createAuditLog<ProcessInstance<TState>>({
		name: "instances",
		retainedLimit,
		graph: subgraph,
	});

	// Tier 8 γ-7-A (2026-04-28): seq cursor promoted from `let seq = 0` closure
	// to a `state(0)` node mounted on the per-process subgraph (visible in
	// `describe()` at `__processManagers__/<name>::seq`). The audit-record
	// stamping routes through `wrapMutation` for centralized freeze + seq
	// advance + `handlerVersion` stamping + batch-frame rollback. The batch
	// frame closes EH-17 (lightMutation re-entrancy hazard).
	const seqCursor = registerCursor(subgraph, "seq", 0);

	// D4 (qa lock): `freeze: true` so step-handler-supplied state values
	// captured into audit records cannot be mutated post-record. Process
	// states are typically small workflow records (an order ID + a few
	// flags), so the `deepFreeze` tax is negligible — the safety vs. mutation
	// trade-off favors freeze. (The 768-dim-vector concern that motivates
	// `freeze: false` in memory primitives doesn't apply here.)
	const appendRecord = wrapMutation<
		[string, TState, ProcessInstance<TState>["status"], string | undefined],
		void,
		ProcessInstance<TState>
	>(
		// No closure-state mutation in the action — the audit-record append IS
		// the effect, performed by the framework via `onSuccess`.
		() => undefined,
		{
			audit: instances,
			seq: seqCursor,
			freeze: true,
			...(opts.handlerVersion !== undefined ? { handlerVersion: opts.handlerVersion } : {}),
			onSuccess: ([correlationId, state, status, reason], _r, { t_ns, seq }) => ({
				correlationId,
				state,
				status,
				startedAt: startedAt.get(correlationId) ?? t_ns,
				updatedAt: t_ns,
				t_ns,
				seq: seq ?? 0,
				...(reason !== undefined ? { reason } : {}),
			}),
		},
	);

	// ── State-snapshot persistence (Tier 6.5 3.5) ─────────────────────────
	const stateStorageTiers = opts.persistence?.stateStorage ?? [];
	const persistState = (
		correlationId: string,
		status: ProcessStateSnapshot<TState>["status"],
	): void => {
		if (stateStorageTiers.length === 0) return;
		const stateValue = instanceStates.get(correlationId);
		if (stateValue === undefined) return;
		const snapshot: ProcessStateSnapshot<TState> = {
			correlationId,
			state: stateValue,
			status,
			startedAt: startedAt.get(correlationId) ?? wallClockNs(),
			updatedAt: wallClockNs(),
			...(opts.handlerVersion !== undefined ? { handlerVersion: opts.handlerVersion } : {}),
		};
		for (const tier of stateStorageTiers) {
			try {
				const r = tier.save(correlationId, snapshot);
				// Tier may return Promise — fire-and-forget. Storage errors
				// surface via the tier's own onError plumbing (Tier 4 storage).
				if (r != null && typeof (r as Promise<void>).then === "function") {
					(r as Promise<void>).catch(() => undefined);
				}
			} catch {
				// best-effort; persistence failures don't block step execution
			}
		}
	};
	const removeState = (correlationId: string): void => {
		if (stateStorageTiers.length === 0) return;
		for (const tier of stateStorageTiers) {
			if (!tier.delete) continue;
			try {
				const r = tier.delete(correlationId);
				if (r != null && typeof (r as Promise<void>).then === "function") {
					(r as Promise<void>).catch(() => undefined);
				}
			} catch {
				// best-effort
			}
		}
	};

	// ── Synthetic event helpers ───────────────────────────────────────────
	const startedEventType = `_process_${name}_started`;

	// Pre-register the started event stream so it appears in describe().
	// Side-effect events (result.emit) dispatch using their own declared event type
	// via _appendEvent directly — no separate state event stream needed.
	cqrsGraph.event(startedEventType);

	// Wire persistence: event storage for synthetic state stream.
	if (opts.persistence?.eventStorage) {
		cqrsGraph.attachEventStorage(opts.persistence.eventStorage);
	}

	// ── Compensation helper ───────────────────────────────────────────────
	async function runCompensate(
		correlationId: string,
		state: TState,
		error: unknown,
		reason?: string,
	): Promise<void> {
		// Eagerly remove from active state BEFORE any await so that concurrent
		// cancel() calls or in-flight step completions that arrive while we are
		// awaiting the compensate handler find the instance already gone and
		// exit early (C1 — double-compensation race fix).
		activeInstances.delete(correlationId);
		instanceStates.delete(correlationId);
		startedAt.delete(correlationId);

		if (opts.compensate) {
			try {
				await toPromise(opts.compensate(state, error) as NodeInput<void>);
				appendRecord(correlationId, state, "compensated", reason);
				removeState(correlationId);
			} catch (_compErr) {
				// Compensation itself failed — still mark as errored so instance
				// doesn't stay in limbo. Swallow error to prevent cascading.
				appendRecord(correlationId, state, "errored", undefined);
				removeState(correlationId);
			}
		} else {
			appendRecord(correlationId, state, "errored", undefined);
			removeState(correlationId);
		}
	}

	// ── Step result handler ───────────────────────────────────────────────
	async function handleStepResult(
		correlationId: string,
		result: ProcessStepResult<TState>,
	): Promise<void> {
		if (!activeInstances.has(correlationId)) return; // cancelled during async step

		if (result.outcome === "failure") {
			// Capture state before eager delete (C1 — step-fail eager-delete).
			const state = instanceStates.get(correlationId) ?? opts.initial;
			// runCompensate handles the eager delete; the early-exit guard above
			// ensures we won't double-compensate for an already-inactive instance.
			await runCompensate(correlationId, state, result.error);
			return;
		}

		if (result.outcome === "success") {
			instanceStates.set(correlationId, result.state);

			// Emit side-effect CQRS events.
			if (result.emit) {
				for (const ev of result.emit) {
					// Dispatch via _appendEvent is internal. Use a synthetic command
					// channel via the public `dispatch` API by pre-registering a
					// passthrough command, OR emit directly via an internal event.
					// Strategy: use event stream directly — the process manager is
					// an internal coordinator allowed to call internal CQRS APIs.
					// We use the synthetic stateEventType to carry side-effect events
					// so they appear in the aggregate stream.
					try {
						// Emit side-effect events using the process state event stream with
						// the correlationId as aggregateId, but use the declared event type
						// as the type field for downstream sagas/projections to react to.
						// We do this by directly dispatching into the CQRS graph via the
						// dedicated per-process synthetic event channel.
						(
							cqrsGraph as unknown as {
								_appendEvent(
									name: string,
									payload: unknown,
									extra?: { correlationId?: string; aggregateId?: string },
								): void;
							}
						)._appendEvent(ev.type, ev.payload, {
							correlationId,
							aggregateId: correlationId,
						});
					} catch (_emitErr) {
						// Non-fatal: side-effect event emission failures are not
						// step-fatal (they are fire-and-forget coordination signals).
					}
				}
			}

			appendRecord(correlationId, result.state, "running", undefined);
			persistState(correlationId, "running");

			// Check isTerminal predicate.
			if (opts.isTerminal?.(result.state)) {
				activeInstances.delete(correlationId);
				instanceStates.delete(correlationId);
				startedAt.delete(correlationId); // M3 — cleanup startedAt on isTerminal terminate
				appendRecord(correlationId, result.state, "terminated", undefined);
				removeState(correlationId);
				return;
			}

			// Handle schedule: fire synthetic event after delay via fromTimer.
			if (result.schedule) {
				const { afterMs, eventType } = result.schedule;
				// fromTimer per spec §5.8 — reactive timer source.
				// Subscribe to fire once and deliver the synthetic event.
				// M6: use `let timerUnsub` + TDZ guard to avoid referencing the
				// variable before its assignment if the callback fires synchronously.
				let timerUnsub: (() => void) | undefined;
				const timerNode = fromTimer(afterMs);
				const timerCb: Parameters<typeof timerNode.subscribe>[0] = (msgs) => {
					for (const m of msgs) {
						if (m[0] === DATA) {
							// TDZ guard: if subscribe() hasn't returned yet, defer cleanup.
							if (timerUnsub) {
								timerUnsub();
							} else {
								// fromTimer is async (setTimeout-backed) so this path is
								// never hit in practice, but guard for safety.
								queueMicrotask(() => timerUnsub?.());
							}
							if (!activeInstances.has(correlationId)) return;
							const currentState = instanceStates.get(correlationId);
							if (currentState === undefined) return;
							const step = (
								opts.steps as unknown as Record<string, ProcessStep<TState, EM, string>>
							)[eventType];
							if (!step) return;
							const syntheticEvent: CqrsEvent = {
								type: eventType,
								// m5: null payload (not undefined) to avoid soft §1.2 risk.
								// seq: Number.NaN — sentinel for synthetic events that do not
								// participate in cross-event ordering.
								payload: null,
								timestampNs: wallClockNs(),
								seq: Number.NaN,
								correlationId,
								aggregateId: correlationId,
							};
							dispatchStep(correlationId, step, currentState, syntheticEvent);
						}
					}
				};
				timerUnsub = timerNode.subscribe(timerCb);
			}
			return;
		}

		if (result.outcome === "terminate") {
			instanceStates.set(correlationId, result.state);
			// Emit side-effect events.
			if (result.emit) {
				for (const ev of result.emit) {
					try {
						(
							cqrsGraph as unknown as {
								_appendEvent(
									name: string,
									payload: unknown,
									extra?: { correlationId?: string; aggregateId?: string },
								): void;
							}
						)._appendEvent(ev.type, ev.payload, {
							correlationId,
							aggregateId: correlationId,
						});
					} catch (_emitErr) {
						// non-fatal
					}
				}
			}
			activeInstances.delete(correlationId);
			instanceStates.delete(correlationId);
			startedAt.delete(correlationId); // M3 — cleanup startedAt on terminate
			appendRecord(correlationId, result.state, "terminated", undefined);
			removeState(correlationId);
		}
	}

	// ── Step dispatch ─────────────────────────────────────────────────────
	// C2: Per-correlationId in-flight serialization map.
	// Multiple events for the same correlationId in one DATA wave both read the
	// same instanceStates snapshot if dispatched concurrently. Serializing via a
	// promise chain ensures the second step sees the first step's written state.
	// Cross-correlationId events still parallelize (separate map entries).
	const inFlight = new Map<string, Promise<void>>();

	function dispatchStep(
		correlationId: string,
		step: ProcessStep<TState, EM, string>,
		_state: TState, // C2: state is re-read inside the serialized closure; this param is kept for call-site clarity
		event: CqrsEvent,
	): void {
		const prior = inFlight.get(correlationId) ?? Promise.resolve();
		const next = prior.then(async () => {
			// Re-read current state at execution time (prior steps may have updated it).
			const currentState = instanceStates.get(correlationId);
			if (currentState === undefined) return; // instance was cancelled/terminated in prior step
			if (!activeInstances.has(correlationId)) return;
			let result: ProcessStepResult<TState>;
			try {
				result = await runWithRetry(
					step as (s: TState, e: CqrsEvent) => NodeInput<ProcessStepResult<TState>>,
					currentState,
					event,
					retryMax,
					backoffMs,
				);
			} catch (err) {
				// runWithRetry itself should not throw (it returns fail on exhaustion),
				// but guard against unexpected errors.
				await runCompensate(correlationId, instanceStates.get(correlationId) ?? opts.initial, err);
				return;
			}
			await handleStepResult(correlationId, result);
		});
		inFlight.set(correlationId, next);
		next.finally(() => {
			if (inFlight.get(correlationId) === next) inFlight.delete(correlationId);
		});
	}

	// C3: disposal flag — set true by dispose(); gates start() and cancel().
	let _disposed = false;

	// ── Watched event subscriptions ───────────────────────────────────────
	// Imperative subscriptions: coordinator bridges reactive CQRS events into
	// per-instance step execution. Not reactive edges — the process manager is
	// an external coordinator, not a graph node. Disposers tracked for cleanup.
	const watchDisposers: Array<() => void> = [];

	for (const eventType of opts.watching) {
		const eventNode = cqrsGraph.event(eventType as string);

		// Subscribe-and-capture pattern (COMPOSITION-GUIDE §28):
		// maintain a cursor (last-processed count) per event type so we only
		// process NEW events on each wave, matching saga's behaviour.
		let lastCount = 0;

		// Seed from existing cache.
		const cached = (eventNode.cache as readonly CqrsEvent[] | undefined) ?? [];
		lastCount = cached.length;

		const unsub = eventNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const events = m[1] as readonly CqrsEvent[];
				if (events.length <= lastCount) continue;
				const newEvents = events.slice(lastCount);
				lastCount = events.length;

				for (const ev of newEvents) {
					const corrId = ev.correlationId;
					if (corrId === undefined) continue;
					if (!activeInstances.has(corrId)) continue;

					const step = (opts.steps as unknown as Record<string, ProcessStep<TState, EM, string>>)[
						eventType as string
					];
					if (!step) continue;

					const state = instanceStates.get(corrId);
					if (state === undefined) continue;

					dispatchStep(corrId, step, state, ev);
				}
			}
		});
		watchDisposers.push(unsub);
	}

	// ── Public API ────────────────────────────────────────────────────────

	// Tier 8 γ-7-A (2026-04-28): `start()` body is wrapMutation-wrapped so the
	// synthetic-start-event emit + the running audit record commit in one
	// batch frame. If `_appendEvent` throws (e.g. event stream terminated),
	// wrapMutation rolls back the in-band batch (audit append discarded, seq
	// cursor advance discarded) and re-throws to the caller. Pre-1.0 behavior
	// change vs. γ-7-B: the previous form silently swallowed `_appendEvent`
	// failures and still appended the running record. Per COMPOSITION-GUIDE
	// §35, closure mutations are NOT rolled back — so they are deferred to
	// after `_appendEvent` succeeds inside the action body.
	const startInternal = wrapMutation<[string, unknown], void, ProcessInstance<TState>>(
		(correlationId, initialPayload) => {
			// Synthetic start event first (potentially throws). Closure
			// mutations below only run if this call succeeds — per §35,
			// rollback does not undo them, so they must come after the
			// throwing work.
			(
				cqrsGraph as unknown as {
					_appendEvent(
						name: string,
						payload: unknown,
						extra?: { correlationId?: string; aggregateId?: string },
					): void;
				}
			)._appendEvent(startedEventType, initialPayload ?? null, {
				correlationId,
				aggregateId: correlationId,
			});
			startedAt.set(correlationId, wallClockNs());
			instanceStates.set(correlationId, opts.initial);
			activeInstances.add(correlationId);
		},
		{
			audit: instances,
			seq: seqCursor,
			freeze: true,
			...(opts.handlerVersion !== undefined ? { handlerVersion: opts.handlerVersion } : {}),
			onSuccess: ([correlationId], _r, { t_ns, seq }) => ({
				correlationId,
				state: opts.initial,
				status: "running",
				startedAt: startedAt.get(correlationId) ?? t_ns,
				updatedAt: t_ns,
				t_ns,
				seq: seq ?? 0,
			}),
		},
	);

	/**
	 * Start a new process instance.
	 *
	 * Idempotent: if a running instance with the same `correlationId` already
	 * exists, the call is a no-op. Also a no-op after `dispose()`.
	 *
	 * **Throws** if the synthetic `_process_<name>_started` event stream is
	 * terminated (γ-7-A, 2026-04-28). The audit log is not appended in that
	 * case — the in-band batch rolls back so the seq cursor and audit log
	 * stay consistent with the pre-call state.
	 */
	function start(correlationId: string, initialPayload?: unknown): void {
		if (_disposed) return;
		if (activeInstances.has(correlationId)) return;
		startInternal(correlationId, initialPayload);
		persistState(correlationId, "running");
	}

	/**
	 * Cancel a running instance and trigger compensation.
	 *
	 * No-op if the instance is not currently running (or after `dispose()`).
	 */
	function cancel(correlationId: string, reason?: string): void {
		if (_disposed) return;
		if (!activeInstances.has(correlationId)) return;

		// Capture state before the async compensate path.
		const state = instanceStates.get(correlationId) ?? opts.initial;
		// Run compensation asynchronously (fire-and-forget from caller perspective).
		// C1: runCompensate does the eager activeInstances.delete before any await,
		// so concurrent calls or in-flight steps that complete concurrently find the
		// instance already removed and exit early.
		// M4: pass reason through so it lands on the audit record.
		runCompensate(
			correlationId,
			state,
			new Error(`cancelled: ${reason ?? "no reason given"}`),
			reason,
		);
	}

	/**
	 * Read the current in-memory state for a correlationId.
	 *
	 * Returns `undefined` if the instance does not exist or has terminated.
	 */
	function getState(correlationId: string): TState | undefined {
		return instanceStates.get(correlationId);
	}

	/**
	 * Release all watched-event subscriptions and stop processing new events.
	 *
	 * After `dispose()`, `start()` and `cancel()` become no-ops. In-flight
	 * async steps complete naturally; no new steps are dispatched after the
	 * watch subscriptions are released.
	 */
	async function restore(): Promise<number> {
		if (_disposed) return 0;
		const tier = stateStorageTiers[0];
		if (tier == null || tier.list == null || tier.load == null) return 0;
		const keys = await tier.list();
		let count = 0;
		for (const key of keys) {
			const snap = await tier.load(key);
			if (snap == null) continue;
			if (snap.status !== "running") continue;
			instanceStates.set(snap.correlationId, snap.state);
			activeInstances.add(snap.correlationId);
			startedAt.set(snap.correlationId, snap.startedAt);
			count += 1;
		}
		return count;
	}

	function dispose(): void {
		if (_disposed) return;
		_disposed = true;
		// Release all watched-event subscriptions (C3 — watchDisposers leak fix).
		for (const unsub of watchDisposers) {
			try {
				unsub();
			} catch (_err) {
				// non-fatal: best-effort teardown
			}
		}
		watchDisposers.length = 0;
		// EH-16 (Tier 6.5 3.3): unmount the per-instance subgraph so the
		// audit log + seq cursor nodes are removed from the CQRS graph and
		// don't leak across repeated create/dispose cycles. `Graph.remove`
		// fires TEARDOWN through the subtree.
		try {
			cqrsGraph.remove(mountName);
		} catch (_err) {
			// non-fatal: best-effort teardown (e.g. cqrsGraph already destroyed)
		}
	}

	return {
		instances,
		audit: instances,
		start,
		cancel,
		getState,
		restore,
		dispose,
	};
}
